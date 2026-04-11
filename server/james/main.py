"""JAMES — FastAPI application with management API and OpenAI-compatible proxy."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from james.config import settings
from james.database import Model, Telemetry, init_db
from james.hardware import get_hardware_info, estimate_model_memory
from james.hf_client import HuggingFaceClient
from james.process_manager import process_manager, BackendProcess
from james.template_validator import validate_model_dir

logger = logging.getLogger(__name__)

# Path to frontend build
WEB_DIST = Path(__file__).parent.parent.parent / "web" / "dist"

# Global state
db_session_factory = None
hf_client: Optional[HuggingFaceClient] = None
ws_connections: list[WebSocket] = []  # For real-time updates to frontend


# --- Pydantic models ---


class ModelDownloadRequest(BaseModel):
    hf_id: str
    filename: Optional[str] = None  # For GGUF: specific file. For MLX: None = whole repo
    local_dir: Optional[str] = None


class ModelLoadRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    ctx_size: int = settings.default_ctx_size
    flash_attn: str = settings.default_flash_attn
    cache_type_k: str = settings.default_cache_type_k
    cache_type_v: str = settings.default_cache_type_v
    gpu_layers: int = settings.default_gpu_layers
    n_parallel: int = settings.default_n_parallel


class ModelUnloadRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_id: str


class SearchRequest(BaseModel):
    query: str
    limit: int = 20


# --- Lifespan ---


async def _auto_detect_backends():
    """Scan common ports for already-running llama-server or mlx-openai-server instances
    and auto-connect them to JAMES."""
    import httpx

    # Check the llama.cpp port range and the common manual port (8081)
    ports_to_check = list(set([8081] + list(range(settings.llamacpp_port_range[0], settings.llamacpp_port_range[1] + 1))))

    print(f"[JAMES] Auto-detecting backends on ports: {ports_to_check}")
    connected = []
    for port in ports_to_check:
        # Skip our own server port
        if port == settings.port:
            continue

        url = f"http://127.0.0.1:{port}"
        try:
            r = httpx.get(f"{url}/v1/models", timeout=2)
            if r.status_code != 200:
                continue

            data = r.json()
            if not data.get("data"):
                continue

            model_name = data["data"][0]["id"]
            # Use the stem (without .gguf) as the canonical ID to match the database
            if model_name.endswith(".gguf"):
                stem = model_name[:-5]  # strip .gguf
            else:
                stem = model_name

            print(f"[JAMES] Auto-detected backend on port {port}: {model_name} (stem: {stem})")
            logger.info(f"Auto-detected backend on port {port}: {model_name} (stem: {stem})")

            # Check if already tracked (by either name)
            if process_manager.get_process(model_name) or process_manager.get_process(stem):
                print(f"[JAMES] Already tracked, skipping: {stem}")
                logger.info(f"Already tracked, skipping: {stem}")
                continue

            # Try to match with an existing database entry
            session = db_session_factory()
            db_id = stem  # default
            try:
                # Try exact match by ID
                model = session.query(Model).filter(Model.id == stem).first()
                if not model:
                    # Try matching by .gguf filename (e.g. model_name in gguf_file column)
                    model = session.query(Model).filter(Model.gguf_file.contains(model_name)).first()
                if not model:
                    # Try matching by name containing the stem
                    model = session.query(Model).filter(Model.name.contains(stem)).first()

                if model:
                    # Use the existing database ID so frontend can reference it
                    db_id = model.id
                    model.status = "running"
                    model.port = port
                    model.pid = None  # external process, we don't track PID
                    session.commit()
                    print(f"[JAMES] Matched to DB model: {db_id}")
                else:
                    # Create a new DB entry for this detected model
                    model = Model(
                        id=stem,
                        name=model_name,
                        backend="gguf",
                        status="running",
                        port=port,
                    )
                    session.add(model)
                    session.commit()
                    print(f"[JAMES] Created new DB entry for: {stem}")
            finally:
                session.close()

            # Register with process manager using the DB ID
            process_manager.register_external(
                model_id=db_id,
                backend="gguf",
                base_url=url,
                port=port,
            )
            print(f"[JAMES] Registered external backend: {db_id} on port {port}")
            logger.info(f"Registered external backend: {db_id} on port {port}")

            connected.append(f"{db_id} on :{port}")
        except Exception:
            continue

    if connected:
        logger.info(f"Auto-detected running backends: {', '.join(connected)}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    global db_session_factory, hf_client

    # Startup
    settings.ensure_dirs()
    db_session_factory = init_db(settings.db_path)
    hf_client = HuggingFaceClient(token=None)  # TODO: load from config

    # Reset any stale "running" or "error" statuses from previous sessions
    session = db_session_factory()
    try:
        stale = session.query(Model).filter(Model.status.in_(["running", "error"])).all()
        for m in stale:
            m.status = "available"
            m.port = None
            m.pid = None
        session.commit()
        if stale:
            logger.info(f"Reset {len(stale)} stale model(s) to available")
    finally:
        session.close()

    # Auto-detect running backends on common ports
    await _auto_detect_backends()

    logger.info("Flow LLM started — data dir: %s", settings.data_dir)

    yield

    # Shutdown
    logger.info("Shutting down backends...")
    await process_manager.stop_all()
    logger.info("JAMES stopped.")


# --- App ---


app = FastAPI(
    title="Flow LLM",
    description="macOS LLM Orchestration — local model management and OpenAI-compatible proxy",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- WebSocket for real-time updates ---


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates to the frontend."""
    await websocket.accept()
    ws_connections.append(websocket)
    try:
        while True:
            # Keep connection alive — frontend sends pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_connections.remove(websocket)


async def broadcast(event_type: str, data: dict):
    """Broadcast an event to all connected WebSocket clients."""
    import json
    message = json.dumps({"type": event_type, "data": data})
    for ws in ws_connections[:]:
        try:
            await ws.send_text(message)
        except Exception:
            ws_connections.remove(ws)


# --- Management API: Hardware ---


@app.get("/api/hardware")
async def get_hardware():
    """Get hardware info (chip, memory, etc.)."""
    info = get_hardware_info()
    return {
        "chip": info.chip,
        "memory_total_gb": info.memory_total_gb,
        "memory_available_gb": info.memory_available_gb,
        "memory_used_gb": info.memory_used_gb,
        "cpu_count": info.cpu_count,
        "is_apple_silicon": info.is_apple_silicon,
        "metal_supported": info.metal_supported,
        "recommended_max_model_gb": info.recommended_max_model_gb,
    }


# --- Management API: Models ---


@app.get("/api/models")
async def list_models():
    """List all locally available models."""
    session = db_session_factory()
    try:
        models = session.query(Model).all()
        return [
            {
                "id": m.id,
                "name": m.name,
                "hf_id": m.hf_id,
                "backend": m.backend,
                "gguf_file": m.gguf_file,
                "mlx_path": m.mlx_path,
                "quantization": m.quantization,
                "size_gb": m.size_gb,
                "memory_gb": m.memory_gb,
                "template_valid": m.template_valid,
                "supports_tools": m.supports_tools,
                "status": m.status,
                "port": m.port,
                "pid": m.pid,
            }
            for m in models
        ]
    finally:
        session.close()


@app.get("/api/models/running")
async def list_running_models():
    """List all currently running models with live status."""
    processes = process_manager.get_all_processes()
    hw = get_hardware_info()

    result = []
    session = db_session_factory()
    try:
        for model_id, proc in processes.items():
            model = session.query(Model).filter(Model.id == model_id).first()
            result.append({
                "model_id": model_id,
                "name": model.name if model else model_id,
                "backend": proc.backend,
                "port": proc.port,
                "base_url": proc.base_url + "/v1",
                "pid": proc.get_pid(),
                "is_running": proc.is_running(),
            })
    finally:
        session.close()

    return {
        "models": result,
        "hardware": {
            "chip": hw.chip,
            "memory_total_gb": hw.memory_total_gb,
            "memory_available_gb": hw.memory_available_gb,
            "memory_used_gb": hw.memory_used_gb,
        },
    }


@app.get("/api/models/{model_id}")
async def get_model(model_id: str):
    """Get details for a specific model."""
    session = db_session_factory()
    try:
        model = session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise HTTPException(404, f"Model {model_id} not found")
        return {
            "id": model.id,
            "name": model.name,
            "hf_id": model.hf_id,
            "backend": model.backend,
            "gguf_file": model.gguf_file,
            "mlx_path": model.mlx_path,
            "quantization": model.quantization,
            "size_gb": model.size_gb,
            "memory_gb": model.memory_gb,
            "template_valid": model.template_valid,
            "template_errors": model.template_errors,
            "supports_tools": model.supports_tools,
            "status": model.status,
            "port": model.port,
            "pid": model.pid,
            "created_at": model.created_at.isoformat() if model.created_at else None,
        }
    finally:
        session.close()


@app.post("/api/models/download")
async def download_model(request: ModelDownloadRequest):
    """Download a model from HuggingFace Hub."""
    if not hf_client:
        raise HTTPException(500, "HuggingFace client not initialized")

    session = db_session_factory()
    try:
        # Determine backend type
        if request.filename and request.filename.endswith(".gguf"):
            backend = "gguf"
        elif request.filename is None:
            backend = "mlx"
        else:
            backend = "gguf"

        # Download
        local_dir = request.local_dir or str(settings.models_dir)
        try:
            downloaded_path = hf_client.download_model(
                model_id=request.hf_id,
                filename=request.filename,
                local_dir=local_dir,
            )
        except Exception as e:
            raise HTTPException(500, f"Download failed: {e}")

        # Validate template
        model_dir = downloaded_path.parent if downloaded_path.is_file() else downloaded_path
        validation = validate_model_dir(model_dir)

        # Determine file paths
        if backend == "gguf":
            gguf_file = str(downloaded_path) if downloaded_path.is_file() else None
            mlx_path = None
        else:
            gguf_file = None
            mlx_path = str(downloaded_path)

        # Calculate size
        size_gb = None
        if downloaded_path.is_file():
            size_gb = round(downloaded_path.stat().st_size / (1024**3), 2)
        elif downloaded_path.is_dir():
            # For MLX: sum all files in the directory
            total_bytes = sum(f.stat().st_size for f in downloaded_path.rglob("*") if f.is_file())
            size_gb = round(total_bytes / (1024**3), 2)

        # Generate model ID
        model_id = request.hf_id.replace("/", "__")
        if request.filename:
            # For GGUF: include the filename for uniqueness
            stem = Path(request.filename).stem
            if stem.endswith(".gguf"):
                stem = stem[:-5]
            model_id = stem  # Use the GGUF filename stem (e.g. "gemma-4-26B-A4B-it-UD-Q4_K_M")

        # Generate display name
        if request.filename:
            name = request.filename
        else:
            # For MLX: use the repo name
            name = request.hf_id.split("/")[-1] if "/" in request.hf_id else request.hf_id

        # Save to registry
        model = Model(
            id=model_id,
            name=name,
            hf_id=request.hf_id,
            backend=backend,
            gguf_file=gguf_file,
            mlx_path=mlx_path,
            quantization=hf_client._extract_quant(request.filename or ""),
            size_gb=size_gb,
            template_valid=validation.valid,
            template_errors="; ".join(validation.errors) if validation.errors else None,
            supports_tools=validation.supports_tools,
            status="available",
        )

        session.add(model)
        session.commit()

        await broadcast("model_downloaded", {"model_id": model_id})

        return {
            "model_id": model_id,
            "path": str(downloaded_path),
            "backend": backend,
            "template_valid": validation.valid,
            "supports_tools": validation.supports_tools,
            "errors": validation.errors,
            "warnings": validation.warnings,
        }
    finally:
        session.close()


@app.delete("/api/models/{model_id}")
async def delete_model(model_id: str):
    """Delete a model from disk and registry."""
    session = db_session_factory()
    try:
        model = session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise HTTPException(404, f"Model {model_id} not found")
        if model.status == "running":
            raise HTTPException(400, f"Model {model_id} is running. Unload it first.")

        # Delete files
        import shutil
        if model.gguf_file and Path(model.gguf_file).exists():
            Path(model.gguf_file).unlink()
        if model.mlx_path and Path(model.mlx_path).exists():
            shutil.rmtree(model.mlx_path, ignore_errors=True)

        session.delete(model)
        session.commit()

        await broadcast("model_deleted", {"model_id": model_id})
        return {"status": "deleted", "model_id": model_id}
    finally:
        session.close()


@app.post("/api/models/scan")
async def scan_local_models():
    """Scan the models directory for GGUF/MLX files not yet in the registry.

    This finds models that were downloaded manually (e.g., via gemma4.sh)
    and registers them in the database.
    """
    from james.config import settings
    session = db_session_factory()
    found = []

    try:
        models_dir = settings.models_dir
        if not models_dir.exists():
            return {"found": [], "message": f"Models directory not found: {models_dir}"}

        # Walk the models directory for GGUF files
        for gguf_path in models_dir.rglob("*.gguf"):
            model_id = gguf_path.stem  # filename without extension
            # Check if already registered
            existing = session.query(Model).filter(Model.gguf_file == str(gguf_path)).first()
            if existing:
                continue

            # Get file size
            size_gb = round(gguf_path.stat().st_size / (1024**3), 2)

            # Validate template (GGUF files have templates embedded)
            from james.template_validator import validate_model_dir
            validation = validate_model_dir(gguf_path.parent)

            model = Model(
                id=model_id,
                name=gguf_path.name,
                hf_id=None,
                backend="gguf",
                gguf_file=str(gguf_path),
                mlx_path=None,
                quantization=HuggingFaceClient._extract_quant(gguf_path.name),
                size_gb=size_gb,
                template_valid=validation.valid,
                supports_tools=validation.supports_tools,
                status="available",
            )
            session.add(model)
            found.append({
                "id": model_id,
                "name": gguf_path.name,
                "backend": "gguf",
                "size_gb": size_gb,
                "path": str(gguf_path),
            })

        session.commit()
        return {"found": found, "total": len(found)}
    except Exception as e:
        session.rollback()
        raise HTTPException(500, f"Scan failed: {e}")
    finally:
        session.close()


@app.get("/api/downloads")
async def get_downloads():
    """Get status of all active and recent downloads."""
    return HuggingFaceClient.get_all_downloads()


class RegisterLocalRequest(BaseModel):
    gguf_path: str
    name: Optional[str] = None


@app.post("/api/register-local")
async def register_local_model(request: RegisterLocalRequest):
    """Register a local GGUF file that's already on disk (e.g., downloaded manually).

    This is for models like the one used in gemma4.sh that were downloaded
    outside of JAMES.
    """
    path = Path(request.gguf_path)
    if not path.exists():
        raise HTTPException(404, f"File not found: {request.gguf_path}")
    if not path.suffix == ".gguf":
        raise HTTPException(400, "Only GGUF files can be registered this way")

    session = db_session_factory()
    try:
        # Check if already registered
        existing = session.query(Model).filter(Model.gguf_file == str(path)).first()
        if existing:
            return {"model_id": existing.id, "status": "already_registered"}

        model_name = request.name or path.name
        model_id = path.stem

        # Validate template
        from james.template_validator import validate_model_dir
        validation = validate_model_dir(path.parent)

        size_gb = round(path.stat().st_size / (1024**3), 2)

        model = Model(
            id=model_id,
            name=model_name,
            hf_id=None,
            backend="gguf",
            gguf_file=str(path),
            mlx_path=None,
            quantization=HuggingFaceClient._extract_quant(path.name),
            size_gb=size_gb,
            template_valid=validation.valid,
            supports_tools=validation.supports_tools,
            status="available",
        )
        session.add(model)
        session.commit()

        return {"model_id": model_id, "name": model_name, "size_gb": size_gb}
    finally:
        session.close()


class ConnectExternalRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_id: Optional[str] = None  # If None, auto-detect from the backend
    base_url: str  # e.g. "http://127.0.0.1:8081"
    backend: str = "gguf"


@app.post("/api/connect-external")
async def connect_external_model(request: ConnectExternalRequest):
    """Connect JAMES to an already-running backend (e.g. llama-server started manually).

    This lets you use models that are already loaded without restarting them.
    JAMES will proxy requests to the external backend and track it as a running model.
    """
    import httpx

    base_url = request.base_url.rstrip("/")
    port = int(base_url.split(":")[-1])

    # Verify the backend is actually running
    try:
        r = httpx.get(f"{base_url}/v1/models", timeout=5)
        if r.status_code != 200:
            raise HTTPException(400, f"Backend at {base_url} returned status {r.status_code}")
    except httpx.ConnectError:
        raise HTTPException(400, f"Cannot connect to backend at {base_url}")

    # Auto-detect model name from the backend
    model_id = request.model_id
    if not model_id:
        try:
            data = r.json()
            if data.get("data"):
                model_id = data["data"][0]["id"]
            else:
                raise HTTPException(400, "Cannot auto-detect model name. Provide model_id.")
        except Exception:
            raise HTTPException(400, "Cannot auto-detect model name. Provide model_id.")

    # Check if model exists in registry — try exact match, then by stem (without .gguf)
    session = db_session_factory()
    try:
        model = session.query(Model).filter(Model.id == model_id).first()
        if not model:
            # Try matching without the .gguf extension (llama-server includes it, we strip it)
            stem_id = model_id.replace(".gguf", "")
            model = session.query(Model).filter(Model.id == stem_id).first()
            if model:
                model_id = stem_id  # Use the existing registered ID

        if not model:
            model = Model(
                id=model_id,
                name=model_id,
                backend=request.backend,
                status="running",
                port=port,
            )
            session.add(model)
        else:
            model.status = "running"
            model.port = port
        session.commit()
    finally:
        session.close()

    # Register with process manager as external
    process_manager.register_external(
        model_id=model_id,
        backend=request.backend,
        base_url=base_url,
        port=port,
    )

    await broadcast("model_loaded", {"model_id": model_id, "port": port})

    return {
        "model_id": model_id,
        "status": "running",
        "port": port,
        "base_url": f"{base_url}/v1",
        "external": True,
    }


# --- Management API: Model Loading ---


@app.post("/api/models/{model_id}/load")
async def load_model(model_id: str, request: ModelLoadRequest):
    """Load a model (start its backend process)."""
    session = db_session_factory()
    try:
        model = session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise HTTPException(404, f"Model {model_id} not found")
        if model.status == "running":
            raise HTTPException(400, f"Model {model_id} is already running")

        # Reset error status to available for retry
        if model.status == "error":
            model.status = "available"

        # Determine model path
        model_path = model.gguf_file or model.mlx_path
        if not model_path or not Path(model_path).exists():
            raise HTTPException(400, f"Model file not found: {model_path}")

        # Check memory — on Apple Silicon, unified memory means GPU uses the same pool
        # Use total RAM minus headroom rather than "available" because macOS keeps
        # inactive memory that can be reclaimed, and other apps can be paged out
        hw = get_hardware_info()
        est_memory = estimate_model_memory(
            model.size_gb or 0,
            request.ctx_size,
            request.cache_type_k,
        )
        # Use total RAM minus headroom (8GB system + 20% for KV cache overhead)
        usable_gb = hw.memory_total_gb - max(8, hw.memory_total_gb * 0.15)
        if est_memory > usable_gb:
            raise HTTPException(
                400,
                f"Insufficient memory: need {est_memory:.1f}GB, have {usable_gb:.1f}GB usable ({hw.memory_total_gb:.0f}GB total - headroom)",
            )

        # Update status
        model.status = "loading"
        session.commit()

        try:
            proc = await process_manager.start_model(
                model_id=model_id,
                backend=model.backend,
                model_path=model_path,
                ctx_size=request.ctx_size * request.n_parallel,  # Multiply by parallel slots
                flash_attn=request.flash_attn,
                cache_type_k=request.cache_type_k,
                cache_type_v=request.cache_type_v,
                gpu_layers=request.gpu_layers,
                n_parallel=request.n_parallel,
            )

            model.status = "running"
            model.port = proc.port
            model.pid = proc.get_pid()
            session.commit()

            await broadcast("model_loaded", {
                "model_id": model_id,
                "port": proc.port,
                "pid": proc.get_pid(),
            })

            return {
                "model_id": model_id,
                "status": "running",
                "port": proc.port,
                "base_url": f"http://127.0.0.1:{proc.port}/v1",
            }
        except Exception as e:
            model.status = "error"
            session.commit()
            raise HTTPException(500, f"Failed to start model: {e}")
    finally:
        session.close()


@app.post("/api/models/{model_id}/unload")
async def unload_model(model_id: str):
    """Unload a model (stop its backend process, freeing memory)."""
    print(f"[JAMES] unload_model('{model_id}') called")
    session = db_session_factory()
    try:
        model = session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise HTTPException(404, f"Model {model_id} not found")
        if model.status != "running":
            raise HTTPException(400, f"Model {model_id} is not running")

        port = model.port  # Save port before clearing status
        print(f"[JAMES] Model {model_id} is running on port {port}")
        logger.info(f"Unloading model {model_id} on port {port}")

        # Try stopping by model_id first, then try with .gguf suffix
        stopped = await process_manager.stop_model(model_id)
        print(f"[JAMES] stop_model('{model_id}') = {stopped}")
        if not stopped:
            stopped = await process_manager.stop_model(model_id + ".gguf")
            print(f"[JAMES] stop_model('{model_id}.gguf') = {stopped}")

        # If process_manager doesn't know about it, kill whatever is on that port
        if not stopped and port:
            print(f"[JAMES] Model not in process manager, killing port {port} directly")
            logger.info(f"Model not in process manager, killing port {port} directly")
            stopped = await process_manager._kill_port(port)
            print(f"[JAMES] _kill_port({port}) = {stopped}")

        model.status = "available"
        model.port = None
        model.pid = None
        session.commit()

        await broadcast("model_unloaded", {"model_id": model_id})

        return {"model_id": model_id, "status": "available", "killed": stopped}
    finally:
        session.close()


# --- Management API: HuggingFace Search ---


@app.get("/api/hf/search")
async def search_hf(q: str = "", limit: int = 20):
    """Search HuggingFace Hub for models."""
    if not hf_client:
        raise HTTPException(500, "HuggingFace client not initialized")
    results = hf_client.search_models(q, limit)
    return {"results": results}


@app.get("/api/hf/model/{model_id:path}")
async def get_hf_model(model_id: str):
    """Get rich details for a HuggingFace model."""
    if not hf_client:
        raise HTTPException(500, "HuggingFace client not initialized")

    details = hf_client.get_model_details(model_id)
    if not details:
        raise HTTPException(404, f"Model {model_id} not found on HuggingFace")

    # If this model has a GGUF variant repo, fetch those files too
    gguf_repo_files = []
    if details.get("gguf_repo_id"):
        gguf_repo_files = hf_client.list_gguf_files(details["gguf_repo_id"])

    # If there's an MLX variant repo, fetch its details
    # If this model IS MLX (mlx_repo_id == model_id), use its own details as mlx_details
    mlx_details = None
    if details.get("mlx_repo_id"):
        if details["mlx_repo_id"] == model_id:
            # Model is itself MLX — use its own details
            mlx_details = details
        else:
            mlx_details = hf_client.get_model_details(details["mlx_repo_id"])

    return {
        **details,
        "gguf_repo_files": gguf_repo_files,
        "mlx_details": mlx_details,
        "models_dir": str(settings.models_dir),
    }


# --- Management API: Telemetry ---


@app.get("/api/telemetry")
async def get_telemetry(model_id: Optional[str] = None, limit: int = 100):
    """Get telemetry data for inference requests."""
    session = db_session_factory()
    try:
        query = session.query(Telemetry)
        if model_id:
            query = query.filter(Telemetry.model_id == model_id)
        query = query.order_by(Telemetry.timestamp.desc()).limit(limit)
        results = query.all()

        return {
            "records": [
                {
                    "id": t.id,
                    "model_id": t.model_id,
                    "timestamp": t.timestamp.isoformat() if t.timestamp else None,
                    "ttft_ms": t.ttft_ms,
                    "tokens_per_sec": t.tokens_per_sec,
                    "input_tokens": t.input_tokens,
                    "output_tokens": t.output_tokens,
                    "total_tokens": t.total_tokens,
                    "backend": t.backend,
                    "error": t.error,
                }
                for t in results
            ]
        }
    finally:
        session.close()


# --- OpenAI-Compatible Proxy ---


@app.post("/v1/chat/completions")
async def chat_completions(request: dict):
    """Proxy chat completion requests to the appropriate backend.

    This is the endpoint OpenClaw talks to. It routes by model name
    to the correct backend process, collects telemetry, and streams
    responses transparently — no prompt modification.
    """
    model_name = request.get("model", "")
    proc = process_manager.get_process(model_name)

    if not proc:
        raise HTTPException(404, f"Model '{model_name}' is not loaded. Available: {list(process_manager.get_all_processes().keys())}")

    start_time = time.monotonic()
    backend_url = proc.base_url

    if request.get("stream", False):
        # Streaming response — client must outlive the generator
        async def stream_with_metrics():
            first_token_time = None
            total_output_tokens = 0
            client = httpx.AsyncClient(timeout=300.0)
            try:
                async with client.stream(
                    "POST",
                    f"{backend_url}/v1/chat/completions",
                    json=request,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                yield "data: [DONE]\n\n"
                                break
                            try:
                                import json
                                chunk = json.loads(data)
                                if chunk.get("choices") and chunk["choices"][0].get("delta", {}).get("content"):
                                    if first_token_time is None:
                                        first_token_time = time.monotonic()
                                    total_output_tokens += 1
                            except Exception:
                                pass
                            yield line + "\n"
                        elif line.strip() == "":
                            yield "\n"
                        else:
                            yield line + "\n"
            finally:
                await client.aclose()

            # Record telemetry
            ttft_ms = (first_token_time - start_time) * 1000 if first_token_time else None
            await _record_telemetry(
                model_id=model_name,
                backend=proc.backend,
                ttft_ms=ttft_ms,
                input_tokens=request.get("max_tokens"),
                output_tokens=total_output_tokens if total_output_tokens else None,
            )

        return StreamingResponse(
            stream_with_metrics(),
            media_type="text/event-stream",
        )
    else:
        # Non-streaming response
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                f"{backend_url}/v1/chat/completions",
                json=request,
                headers={"Content-Type": "application/json"},
            )

            result = response.json()
            end_time = time.monotonic()

            # Extract telemetry
            usage = result.get("usage", {})
            input_tokens = usage.get("prompt_tokens")
            output_tokens = usage.get("completion_tokens")
            total_tokens = usage.get("total_tokens")

            # Calculate TTFT (for non-streaming, this is total time)
            ttft_ms = (end_time - start_time) * 1000
            tokens_per_sec = output_tokens / ((end_time - start_time)) if output_tokens and (end_time > start_time) else None

            await _record_telemetry(
                model_id=model_name,
                backend=proc.backend,
                ttft_ms=ttft_ms,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                tokens_per_sec=tokens_per_sec,
            )

            return result


@app.get("/v1/models")
async def list_available_models():
    """List models available through the proxy (OpenAI-compatible format)."""
    processes = process_manager.get_all_processes()
    data = []
    for model_id, proc in processes.items():
        data.append({
            "id": model_id,
            "object": "model",
            "created": int(time.time()),
            "owned_by": "james",
        })
    return {"object": "list", "data": data}


async def _record_telemetry(
    model_id: str,
    backend: str,
    ttft_ms: Optional[float] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    total_tokens: Optional[int] = None,
    tokens_per_sec: Optional[float] = None,
    error: Optional[str] = None,
):
    """Record a telemetry entry."""
    session = db_session_factory()
    try:
        entry = Telemetry(
            model_id=model_id,
            backend=backend,
            ttft_ms=ttft_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            tokens_per_sec=tokens_per_sec,
            error=error,
        )
        session.add(entry)
        session.commit()
    except Exception as e:
        logger.error(f"Failed to record telemetry: {e}")
    finally:
        session.close()


# --- Health ---


class UpdateSettingsRequest(BaseModel):
    default_ctx_size: Optional[int] = None
    default_flash_attn: Optional[str] = None
    default_cache_type_k: Optional[str] = None
    default_cache_type_v: Optional[str] = None
    default_gpu_layers: Optional[int] = None
    default_n_parallel: Optional[int] = None


@app.get("/api/settings")
async def get_settings():
    """Get current default settings for model loading."""
    return {
        "default_ctx_size": settings.default_ctx_size,
        "default_flash_attn": settings.default_flash_attn,
        "default_cache_type_k": settings.default_cache_type_k,
        "default_cache_type_v": settings.default_cache_type_v,
        "default_gpu_layers": settings.default_gpu_layers,
        "default_n_parallel": settings.default_n_parallel,
        "models_dir": str(settings.models_dir),
    }


@app.put("/api/settings")
async def update_settings(request: UpdateSettingsRequest):
    """Update default settings for model loading."""
    if request.default_ctx_size is not None:
        settings.default_ctx_size = request.default_ctx_size
    if request.default_flash_attn is not None:
        settings.default_flash_attn = request.default_flash_attn
    if request.default_cache_type_k is not None:
        settings.default_cache_type_k = request.default_cache_type_k
    if request.default_cache_type_v is not None:
        settings.default_cache_type_v = request.default_cache_type_v
    if request.default_gpu_layers is not None:
        settings.default_gpu_layers = request.default_gpu_layers
    if request.default_n_parallel is not None:
        settings.default_n_parallel = request.default_n_parallel
    return {"status": "ok"}


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    running = process_manager.get_all_processes()
    return {
        "status": "ok",
        "running_models": len(running),
        "models": list(running.keys()),
    }


# --- Serve frontend ---


if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIST / "assets")), name="assets")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve the React SPA for all non-API routes."""
    if full_path.startswith(("api/", "v1/", "ws")):
        raise HTTPException(404)

    index_path = WEB_DIST / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    raise HTTPException(404, "Frontend not built. Run: cd web && npm run build")


def main():
    """Run the Flow LLM server."""
    import uvicorn
    uvicorn.run(
        "james.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()