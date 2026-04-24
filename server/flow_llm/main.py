"""Flow LLM FastAPI application with management API and OpenAI-compatible proxy."""

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from flow_llm.anthropic_adapter import (
    AnthropicRequestError,
    AnthropicStreamTranslator,
    error_body,
    make_request_id,
    to_anthropic_response,
    to_openai_chat_request,
)
from flow_llm.config import LEGACY_DB_PATH, settings
from flow_llm.database import Model, Telemetry, init_db, migrate_legacy_registry
from flow_llm.hardware import get_hardware_info, estimate_model_memory
from flow_llm.hf_client import HuggingFaceClient
from flow_llm.process_manager import process_manager, BackendProcess
from flow_llm.template_validator import validate_model_dir

logger = logging.getLogger(__name__)

# Path to frontend build (bundled into the package, or fallback to dev build)
WEB_DIST = Path(__file__).parent / "frontend"
if not WEB_DIST.exists():
    WEB_DIST = Path(__file__).parent.parent.parent / "web" / "dist"

# Global state
db_session_factory = None
hf_client: Optional[HuggingFaceClient] = None
ws_connections: list[WebSocket] = []  # For real-time updates to frontend

# Per-model runtime config — ephemeral, cleared on unload/restart
_model_configs: dict[str, dict] = {}

# Built-in (read-only) presets
BUILTIN_PRESETS = [
    {
        "id": "qwen3_thinking",
        "name": "Qwen3.6 — Thinking",
        "builtin": True,
        "config": {
            "temperature": 0.6,
            "top_p": 0.95,
            "top_k": 20,
            "presence_penalty": 1.5,
            "chat_template_kwargs": {"preserve_thinking": True, "enable_thinking": True},
        },
    },
    {
        "id": "qwen3_no_thinking",
        "name": "Qwen3.6 — No Thinking",
        "builtin": True,
        "config": {
            "temperature": 0.7,
            "top_p": 0.8,
            "top_k": 20,
            "presence_penalty": 1.5,
            "chat_template_kwargs": {"enable_thinking": False},
        },
    },
    {
        "id": "qwen3_thinking_coding",
        "name": "Qwen3.6 — Thinking (coding)",
        "builtin": True,
        "config": {
            "temperature": 0.6,
            "top_p": 0.95,
            "top_k": 20,
            "presence_penalty": 0.0,
            "chat_template_kwargs": {"preserve_thinking": True, "enable_thinking": True},
        },
    },
    {
        "id": "gemma4",
        "name": "Gemma 4",
        "builtin": True,
        "config": {"temperature": 1.0},
    },
    {
        "id": "default",
        "name": "Default (no injection)",
        "builtin": True,
        "config": {},
    },
]


# --- Pydantic models ---


class ModelDownloadRequest(BaseModel):
    hf_id: str
    filename: Optional[str] = None  # For GGUF: specific file. For MLX: None = whole repo
    local_dir: Optional[str] = None
    expected_size_bytes: Optional[int] = None


class ModelLoadRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    # GGUF (llama.cpp) params
    ctx_size: int = settings.default_ctx_size
    flash_attn: str = settings.default_flash_attn
    cache_type_k: str = settings.default_cache_type_k
    cache_type_v: str = settings.default_cache_type_v
    gpu_layers: int = settings.default_gpu_layers
    n_parallel: int = settings.default_n_parallel
    # MLX (mlx-openai-server) params
    mlx_context_length: int = 0  # 0 = model default
    mlx_prompt_cache_size: int = 10
    mlx_enable_auto_tool_choice: bool = False
    mlx_reasoning_parser: str = ""
    mlx_tool_call_parser: str = ""
    mlx_chat_template_file: str = ""
    mlx_trust_remote_code: bool = False
    mlx_model_type: str = "lm"  # "lm" | "multimodal"


class ModelUnloadRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_id: str


class SearchRequest(BaseModel):
    query: str
    limit: int = 20


# --- Lifespan ---


async def _auto_detect_backends():
    """Scan common ports for already-running llama-server or mlx-openai-server instances
    and auto-connect them to Flow LLM."""
    import httpx

    # Check the llama.cpp port range and the common manual port (8081)
    ports_to_check = list(set([8081] + list(range(settings.llamacpp_port_range[0], settings.llamacpp_port_range[1] + 1))))

    print(f"[Flow] Auto-detecting backends on ports: {ports_to_check}")
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

            print(f"[Flow] Auto-detected backend on port {port}: {model_name} (stem: {stem})")
            logger.info(f"Auto-detected backend on port {port}: {model_name} (stem: {stem})")

            # Check if already tracked (by either name)
            if process_manager.get_process(model_name) or process_manager.get_process(stem):
                print(f"[Flow] Already tracked, skipping: {stem}")
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
                    print(f"[Flow] Matched to DB model: {db_id}")
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
                    print(f"[Flow] Created new DB entry for: {stem}")
            finally:
                session.close()

            # Register with process manager using the DB ID
            process_manager.register_external(
                model_id=db_id,
                backend="gguf",
                base_url=url,
                port=port,
            )
            print(f"[Flow] Registered external backend: {db_id} on port {port}")
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
    settings.load_from_disk()
    settings.ensure_dirs()
    db_session_factory = init_db(settings.db_path)
    hf_client = HuggingFaceClient(token=None)  # TODO: load from config

    migrated = migrate_legacy_registry(db_session_factory, LEGACY_DB_PATH)
    if migrated:
        logger.info("Migrated %s model registry entries from %s", migrated, LEGACY_DB_PATH)

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

    # Check for backend updates (non-blocking — runs in background)
    from flow_llm.updater import check_and_autoupdate
    asyncio.create_task(check_and_autoupdate(auto_update=settings.auto_update_backends))

    # Periodically prune stuck requests (every 60s)
    async def _prune_stuck_requests():
        from flow_llm.request_tracker import clear_stuck
        while True:
            await asyncio.sleep(60)
            try:
                cleared = clear_stuck()
                if cleared:
                    logger.info(f"Auto-pruned {cleared} stuck request(s)")
            except Exception:
                pass
    asyncio.create_task(_prune_stuck_requests())

    logger.info("Flow LLM started — data dir: %s", settings.data_dir)

    yield

    # Shutdown
    logger.info("Shutting down backends...")
    await process_manager.stop_all()
    logger.info("Flow LLM stopped.")


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
    """WebSocket endpoint for real-time updates to the frontend.

    On connect, sends an init message with the full request tracker state.
    Afterwards, request_update / request_removed / slot_update / metrics_update
    events are pushed in real-time.
    """
    await websocket.accept()
    ws_connections.append(websocket)

    # Send initial state snapshot
    try:
        from flow_llm.request_tracker import get_all_active, prune_completed
        prune_completed()
        snapshot = get_all_active()
        await websocket.send_text(json.dumps({
            "type": "init",
            "data": {"requests": snapshot},
        }))
    except Exception:
        pass

    try:
        while True:
            # Keep connection alive — frontend sends pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in ws_connections:
            ws_connections.remove(websocket)


async def broadcast(event_type: str, data: dict):
    """Broadcast an event to all connected WebSocket clients."""
    message = json.dumps({"type": event_type, "data": data, "ts": time.time()})
    dead = []
    for ws in ws_connections[:]:
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in ws_connections:
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


async def _monitor_download_progress(download_key: str, file_path: Path, expected_bytes: int):
    """Poll on-disk file size to compute download progress %."""
    from flow_llm.hf_client import _active_downloads
    while True:
        await asyncio.sleep(0.75)
        entry = _active_downloads.get(download_key)
        if not entry or entry.get("status") not in ("downloading", "registering"):
            break
        # huggingface_hub 1.x writes directly to local_dir — check the target file and .part suffix
        for candidate in [file_path, Path(str(file_path) + ".part")]:
            if candidate.exists():
                try:
                    size = candidate.stat().st_size
                    entry["progress"] = min(98.0, (size / expected_bytes) * 100)
                except Exception:
                    pass
                break


async def _run_download(request: ModelDownloadRequest, download_key: str):
    """Background task: download a model file and register it in the DB."""
    from flow_llm.hf_client import _active_downloads
    loop = asyncio.get_event_loop()
    session = db_session_factory()

    local_dir = request.local_dir or str(settings.models_dir)
    model_name = request.hf_id.replace("/", "__")
    download_dir = Path(local_dir) / model_name

    # Start file-size progress monitor if we know what to expect
    monitor_task = None
    if request.filename and request.expected_size_bytes:
        expected_path = download_dir / request.filename
        monitor_task = asyncio.create_task(
            _monitor_download_progress(download_key, expected_path, request.expected_size_bytes)
        )

    try:
        downloaded_path = await loop.run_in_executor(
            None,
            lambda: hf_client.download_model(
                model_id=request.hf_id,
                filename=request.filename,
                local_dir=local_dir,
            )
        )

        if monitor_task:
            monitor_task.cancel()

        # Mark as registering while we write to DB
        if download_key in _active_downloads:
            _active_downloads[download_key]["status"] = "registering"
            _active_downloads[download_key]["progress"] = 99.0

        backend = "gguf" if (request.filename and request.filename.endswith(".gguf")) else ("mlx" if request.filename is None else "gguf")

        model_dir = downloaded_path.parent if downloaded_path.is_file() else downloaded_path
        validation = validate_model_dir(model_dir)

        if backend == "gguf":
            gguf_file = str(downloaded_path) if downloaded_path.is_file() else None
            mlx_path = None
        else:
            gguf_file = None
            mlx_path = str(downloaded_path)

        size_gb = None
        if downloaded_path.is_file():
            size_gb = round(downloaded_path.stat().st_size / (1024**3), 2)
        elif downloaded_path.is_dir():
            total_bytes = sum(f.stat().st_size for f in downloaded_path.rglob("*") if f.is_file())
            size_gb = round(total_bytes / (1024**3), 2)

        model_id = request.hf_id.replace("/", "__")
        if request.filename:
            stem = Path(request.filename).stem
            if stem.endswith(".gguf"):
                stem = stem[:-5]
            model_id = stem

        name = request.filename if request.filename else (request.hf_id.split("/")[-1] if "/" in request.hf_id else request.hf_id)

        existing = session.query(Model).filter(Model.id == model_id).first()
        if existing:
            session.delete(existing)
            session.flush()

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

        if download_key in _active_downloads:
            _active_downloads[download_key]["status"] = "complete"
            _active_downloads[download_key]["progress"] = 100.0

        await broadcast("model_downloaded", {"model_id": model_id})

    except Exception as e:
        if monitor_task:
            monitor_task.cancel()
        if download_key in _active_downloads:
            _active_downloads[download_key]["status"] = "error"
            _active_downloads[download_key]["error"] = str(e)
        print(f"[Flow] Download failed for {download_key}: {e}")
    finally:
        session.close()


@app.post("/api/models/download")
async def download_model(request: ModelDownloadRequest):
    """Start a background download from HuggingFace Hub. Returns immediately."""
    if not hf_client:
        raise HTTPException(500, "HuggingFace client not initialized")

    download_key = f"{request.hf_id}/{request.filename}" if request.filename else request.hf_id

    from flow_llm.hf_client import _active_downloads
    _active_downloads[download_key] = {
        "status": "downloading",
        "model_id": request.hf_id,
        "filename": request.filename,
        "progress": 0.0,
    }

    asyncio.create_task(_run_download(request, download_key))
    return {"download_key": download_key, "status": "downloading"}


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
    from flow_llm.config import settings
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
            from flow_llm.template_validator import validate_model_dir
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

        # Detect MLX repos by their directory contents.
        for candidate in models_dir.iterdir():
            if not candidate.is_dir() or candidate.name.startswith("."):
                continue
            if not _looks_like_mlx_model_dir(candidate):
                continue

            existing = session.query(Model).filter(Model.mlx_path == str(candidate)).first()
            if existing:
                continue

            size_gb = round(
                sum(path.stat().st_size for path in candidate.rglob("*") if path.is_file()) / (1024**3),
                2,
            )
            validation = validate_model_dir(candidate)
            model_id = candidate.name
            model_name = candidate.name.split("__", 1)[-1] if "__" in candidate.name else candidate.name

            model = Model(
                id=model_id,
                name=model_name,
                hf_id=None,
                backend="mlx",
                gguf_file=None,
                mlx_path=str(candidate),
                quantization=None,
                size_gb=size_gb,
                template_valid=validation.valid,
                template_errors="; ".join(validation.errors) if validation.errors else None,
                supports_tools=validation.supports_tools,
                status="available",
            )
            session.add(model)
            found.append({
                "id": model_id,
                "name": model_name,
                "backend": "mlx",
                "size_gb": size_gb,
                "path": str(candidate),
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
    gguf_path: Optional[str] = None  # Kept for backwards compatibility
    mlx_path: Optional[str] = None   # For MLX directory registration
    path: Optional[str] = None       # Generic path - accepts GGUF files or MLX dirs
    name: Optional[str] = None


@app.post("/api/register-local")
async def register_local_model(request: RegisterLocalRequest):
    """Register a local GGUF file or MLX directory that's already on disk.

    This is for models downloaded manually outside of Flow LLM.
    Accepts:
      - GGUF files (path/gguf_path or path ending in .gguf)
      - MLX directories (mlx_path or path to a directory)
    """
    # Determine the actual path to use
    if request.path:
        target_path = Path(request.path)
        # Detect type based on what it actually is
        if target_path.is_dir():
            is_mlx = True
        elif target_path.suffix == ".gguf":
            is_mlx = False
        else:
            raise HTTPException(400, "Path must be a .gguf file or a directory containing MLX model")
    elif request.gguf_path:
        target_path = Path(request.gguf_path)
        is_mlx = False
    elif request.mlx_path:
        target_path = Path(request.mlx_path)
        is_mlx = True
    else:
        raise HTTPException(400, "Must provide 'path', 'gguf_path', or 'mlx_path'")

    if not target_path.exists():
        raise HTTPException(404, f"Path not found: {target_path}")

    session = db_session_factory()
    try:
        if is_mlx or target_path.is_dir():
            # MLX directory registration
            if not target_path.is_dir():
                raise HTTPException(400, f"MLX path must be a directory: {target_path}")

            # Check if already registered
            existing = session.query(Model).filter(Model.mlx_path == str(target_path)).first()
            if existing:
                return {"model_id": existing.id, "status": "already_registered"}

            # Calculate directory size
            total_size = sum(f.stat().st_size for f in target_path.rglob('*') if f.is_file())
            size_gb = round(total_size / (1024**3), 2)

            model_name = request.name or target_path.name
            model_id = target_path.name

            # Validate template
            from flow_llm.template_validator import validate_model_dir
            validation = validate_model_dir(target_path)

            model = Model(
                id=model_id,
                name=model_name,
                hf_id=None,
                backend="mlx",
                gguf_file=None,
                mlx_path=str(target_path),
                quantization=None,  # MLX doesn't have quantization in the same way
                size_gb=size_gb,
                template_valid=validation.valid,
                supports_tools=validation.supports_tools,
                status="available",
            )
        else:
            # GGUF file registration
            if not target_path.is_file() or target_path.suffix != ".gguf":
                raise HTTPException(400, "GGUF path must be a .gguf file")

            # Check if already registered
            existing = session.query(Model).filter(Model.gguf_file == str(target_path)).first()
            if existing:
                return {"model_id": existing.id, "status": "already_registered"}

            model_name = request.name or target_path.name
            model_id = target_path.stem

            # Validate template
            from flow_llm.template_validator import validate_model_dir
            validation = validate_model_dir(target_path.parent)

            size_gb = round(target_path.stat().st_size / (1024**3), 2)

            model = Model(
                id=model_id,
                name=model_name,
                hf_id=None,
                backend="gguf",
                gguf_file=str(target_path),
                mlx_path=None,
                quantization=HuggingFaceClient._extract_quant(target_path.name),
                size_gb=size_gb,
                template_valid=validation.valid,
                supports_tools=validation.supports_tools,
                status="available",
            )

        session.add(model)
        session.commit()

        return {"model_id": model.id, "name": model.name, "size_gb": model.size_gb}
    finally:
        session.close()


class ConnectExternalRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_id: Optional[str] = None  # If None, auto-detect from the backend
    base_url: str  # e.g. "http://127.0.0.1:8081"
    backend: str = "gguf"


@app.post("/api/connect-external")
async def connect_external_model(request: ConnectExternalRequest):
    """Connect Flow LLM to an already-running backend (e.g. llama-server started manually).

    This lets you use models that are already loaded without restarting them.
    Flow LLM will proxy requests to the external backend and track it as a running model.
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
            # Auto-select tool-call-parser if empty but model supports tools
            tool_call_parser = request.mlx_tool_call_parser
            chat_template_file = request.mlx_chat_template_file
            if not tool_call_parser and model.supports_tools is True:
                rp = (request.mlx_reasoning_parser or "").lower()
                name = model_id.lower()
                if "qwen" in name or "qwen" in rp:
                    if "3.5" in name or "3.5" in rp:
                        tool_call_parser = "qwen3_coder"
                    else:
                        tool_call_parser = "qwen3"
                    # Qwen MLX conversions often lose proper tool-calling format instructions;
                    # enforce a chat template that knows how to emit <tool_call> tags
                    if not chat_template_file:
                        import pathlib
                        default_tpl = (
                            pathlib.Path(__file__).parent.parent.parent
                            / "templates"
                            / "qwen36_tools_hermes.jinja"
                        )
                        if default_tpl.exists():
                            chat_template_file = str(default_tpl)

            proc = await process_manager.start_model(
                model_id=model_id,
                backend=model.backend,
                model_path=model_path,
                ctx_size=request.ctx_size * request.n_parallel,
                flash_attn=request.flash_attn,
                cache_type_k=request.cache_type_k,
                cache_type_v=request.cache_type_v,
                gpu_layers=request.gpu_layers,
                n_parallel=request.n_parallel,
                mlx_context_length=request.mlx_context_length,
                mlx_prompt_cache_size=request.mlx_prompt_cache_size,
                mlx_enable_auto_tool_choice=request.mlx_enable_auto_tool_choice or (model.supports_tools is True),
                mlx_reasoning_parser=request.mlx_reasoning_parser,
                mlx_tool_call_parser=tool_call_parser,
                mlx_chat_template_file=chat_template_file,
                mlx_trust_remote_code=request.mlx_trust_remote_code,
                mlx_model_type=request.mlx_model_type,
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
    print(f"[Flow] unload_model('{model_id}') called")
    session = db_session_factory()
    try:
        model = session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise HTTPException(404, f"Model {model_id} not found")
        if model.status != "running":
            raise HTTPException(400, f"Model {model_id} is not running")

        port = model.port  # Save port before clearing status
        print(f"[Flow] Model {model_id} is running on port {port}")
        logger.info(f"Unloading model {model_id} on port {port}")

        # Try stopping by model_id first, then try with .gguf suffix
        stopped = await process_manager.stop_model(model_id)
        print(f"[Flow] stop_model('{model_id}') = {stopped}")
        if not stopped:
            stopped = await process_manager.stop_model(model_id + ".gguf")
            print(f"[Flow] stop_model('{model_id}.gguf') = {stopped}")

        # If process_manager doesn't know about it, kill whatever is on that port
        if not stopped and port:
            print(f"[Flow] Model not in process manager, killing port {port} directly")
            logger.info(f"Model not in process manager, killing port {port} directly")
            stopped = await process_manager._kill_port(port)
            print(f"[Flow] _kill_port({port}) = {stopped}")

        model.status = "available"
        model.port = None
        model.pid = None
        session.commit()

        await broadcast("model_unloaded", {"model_id": model_id})
        _model_configs.pop(model_id, None)

        return {"model_id": model_id, "status": "available", "killed": stopped}
    finally:
        session.close()


# --- Per-model runtime config ---


@app.get("/api/models/{model_id}/config")
async def get_model_config(model_id: str):
    """Return current runtime config for a loaded model, plus its load-time params."""
    proc = process_manager.get_process(model_id)
    load_params: dict = {}
    if proc:
        load_params = {
            "backend": proc.backend,
            "ctx_size": getattr(proc, "ctx_size", None),
            "n_parallel": getattr(proc, "n_parallel", None),
            "mlx_context_length": getattr(proc, "mlx_context_length", None),
            "mlx_reasoning_parser": getattr(proc, "mlx_reasoning_parser", None),
            "mlx_tool_call_parser": getattr(proc, "mlx_tool_call_parser", None),
            "mlx_model_type": getattr(proc, "mlx_model_type", None),
        }
    return {"config": _model_configs.get(model_id, {}), "load_params": load_params}


@app.put("/api/models/{model_id}/config")
async def set_model_config(model_id: str, body: dict):
    """Set (merge) runtime config for a model. Caller values win on conflict."""
    _model_configs[model_id] = body
    return {"model_id": model_id, "config": _model_configs[model_id]}


@app.delete("/api/models/{model_id}/config")
async def reset_model_config(model_id: str):
    """Clear runtime config for a model (backend defaults apply)."""
    _model_configs.pop(model_id, None)
    return {"model_id": model_id, "config": {}}


# --- Presets ---


@app.get("/api/presets")
async def list_presets():
    """Return built-in presets + user presets."""
    data = settings.load_presets()
    return {"presets": BUILTIN_PRESETS + data.get("user_presets", [])}


@app.post("/api/presets")
async def create_preset(body: dict):
    """Create a new user preset."""
    name = body.get("name", "").strip()
    config = body.get("config", {})
    if not name:
        raise HTTPException(400, "name is required")
    data = settings.load_presets()
    preset = {"id": str(uuid.uuid4()), "name": name, "builtin": False, "config": config}
    data.setdefault("user_presets", []).append(preset)
    settings.save_presets(data)
    return preset


@app.put("/api/presets/{preset_id}")
async def update_preset(preset_id: str, body: dict):
    """Update a user preset (name and/or config)."""
    data = settings.load_presets()
    for p in data.get("user_presets", []):
        if p["id"] == preset_id:
            if "name" in body:
                p["name"] = body["name"]
            if "config" in body:
                p["config"] = body["config"]
            settings.save_presets(data)
            return p
    raise HTTPException(404, f"Preset {preset_id} not found")


@app.delete("/api/presets/{preset_id}")
async def delete_preset(preset_id: str):
    """Delete a user preset. Built-in presets cannot be deleted."""
    if any(p["id"] == preset_id for p in BUILTIN_PRESETS):
        raise HTTPException(400, "Cannot delete built-in presets")
    data = settings.load_presets()
    before = len(data.get("user_presets", []))
    data["user_presets"] = [p for p in data.get("user_presets", []) if p["id"] != preset_id]
    if len(data["user_presets"]) == before:
        raise HTTPException(404, f"Preset {preset_id} not found")
    settings.save_presets(data)
    return {"status": "deleted"}


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


def _available_model_ids() -> list[str]:
    """Return all currently routed model ids."""
    return list(process_manager.get_all_processes().keys())


def _anthropic_error_response(
    status_code: int,
    error_type: str,
    message: str,
    request_id: str,
):
    """Return an Anthropic-compatible JSON error."""
    return JSONResponse(
        status_code=status_code,
        content=error_body(error_type, message, request_id),
        headers={"request-id": request_id},
    )


def _extract_backend_error_message(payload: Any, raw_text: str) -> str | None:
    """Pull a human-readable error message from an upstream backend response."""
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        if isinstance(error, str):
            return error
        detail = payload.get("detail")
        if isinstance(detail, str):
            return detail
        message = payload.get("message")
        if isinstance(message, str):
            return message
    if raw_text:
        return raw_text
    return None


async def _read_backend_error(response: httpx.Response) -> tuple[Any, str]:
    """Read and parse an upstream backend error payload."""
    raw_bytes = await response.aread()
    raw_text = raw_bytes.decode(errors="replace").strip()
    if not raw_text:
        return None, ""
    try:
        return json.loads(raw_text), raw_text
    except json.JSONDecodeError:
        return None, raw_text


def _map_backend_error(
    status_code: int,
    payload: Any,
    raw_text: str,
    model_name: str,
) -> tuple[int, str, str]:
    """Map backend failures into Anthropic-compatible error semantics."""
    message = _extract_backend_error_message(payload, raw_text)
    if status_code >= 500:
        return (
            status_code,
            "api_error",
            message or f"Backend for model '{model_name}' returned HTTP {status_code}.",
        )

    return (
        status_code if status_code >= 400 else 400,
        "invalid_request_error",
        message or f"Backend rejected the request for model '{model_name}' with HTTP {status_code}.",
    )


def _anthropic_stream_error_event(error_type: str, message: str) -> str:
    """Build an Anthropic SSE error event."""
    return (
        f"event: error\n"
        f"data: {json.dumps({'type': 'error', 'error': {'type': error_type, 'message': message}}, separators=(',', ':'))}\n\n"
    )


@app.post("/v1/messages")
async def anthropic_messages(request: dict):
    """Anthropic-compatible Messages API endpoint for Claude Code and AI-run."""
    from flow_llm.request_tracker import create_request, update_request, complete_request, error_request

    anthro_request_id = make_request_id()
    anthro_input_estimate = _estimate_input_tokens(request.get("messages", []))

    try:
        openai_request = to_openai_chat_request(request)
    except AnthropicRequestError as exc:
        return _anthropic_error_response(exc.status_code, exc.error_type, exc.message, anthro_request_id)

    model_name = openai_request.get("model", "")
    proc = process_manager.get_process(model_name)
    track_id = create_request(model_name, "/v1/messages")

    if not proc:
        error_request(track_id, f"Model '{model_name}' is not loaded")
        return _anthropic_error_response(
            400,
            "invalid_request_error",
            f"Model '{model_name}' is not loaded. Available: {_available_model_ids()}",
            anthro_request_id,
        )

    start_time = time.monotonic()
    backend_url = proc.base_url

    if openai_request.get("stream", False):
        client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=30.0))
        try:
            backend_request = client.build_request(
                "POST",
                f"{backend_url}/v1/chat/completions",
                json=openai_request,
                headers={"Content-Type": "application/json"},
            )
            response = await client.send(backend_request, stream=True)
            update_request(track_id, stage="prefilling")
        except httpx.HTTPError as exc:
            await client.aclose()
            error_request(track_id, f"Failed to reach backend: {exc}")
            message = f"Failed to reach backend for model '{model_name}': {exc}"
            await _record_telemetry(
                model_id=model_name,
                backend=proc.backend,
                error=message,
            )
            return _anthropic_error_response(502, "api_error", message, anthro_request_id)

        if response.status_code >= 400:
            payload, raw_text = await _read_backend_error(response)
            await response.aclose()
            await client.aclose()
            error_request(track_id, f"Backend error {response.status_code}")
            status_code, error_type, message = _map_backend_error(
                response.status_code,
                payload,
                raw_text,
                model_name,
            )
            await _record_telemetry(
                model_id=model_name,
                backend=proc.backend,
                error=message,
            )
            return _anthropic_error_response(status_code, error_type, message, anthro_request_id)

        async def stream_anthropic_events():
            translator = AnthropicStreamTranslator(model_name)
            first_output_time = None
            stream_error_message = None
            try:
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        update_request(track_id, stage="sending")
                        break

                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    try:
                        events, emitted_output = translator.process_chunk(chunk)
                    except AnthropicRequestError as exc:
                        stream_error_message = exc.message
                        yield _anthropic_stream_error_event(exc.error_type, exc.message)
                        return

                    if emitted_output and first_output_time is None:
                        first_output_time = time.monotonic()
                        ttft = (first_output_time - start_time) * 1000
                        update_request(track_id, stage="generating", ttft_ms=ttft, first_token_time=first_output_time)

                    # Update token count for the monitor
                    if translator.output_delta_count:
                        update_request(track_id, output_tokens=translator.output_delta_count)

                    for event in events:
                        yield event

                for event in translator.finish_events():
                    if event.startswith("event: error"):
                        stream_error_message = "Anthropic stream translation failed."
                    yield event
            except httpx.ReadTimeout:
                stream_error_message = "Backend timed out — request took longer than 600s"
                error_request(track_id, stream_error_message)
                yield _anthropic_stream_error_event("api_error", stream_error_message)
                return
            except Exception as exc:
                stream_error_message = str(exc)
                error_request(track_id, stream_error_message)
                yield _anthropic_stream_error_event("api_error", f"Stream error: {stream_error_message}")
                return
            finally:
                await response.aclose()
                await client.aclose()
                end_time = time.monotonic()
                ttft_ms = (first_output_time - start_time) * 1000 if first_output_time else None
                elapsed_sec = (end_time - start_time) if first_output_time else None
                final_output_tokens = translator.output_tokens or (translator.output_delta_count or None)
                tokens_per_sec = (
                    final_output_tokens / elapsed_sec
                    if final_output_tokens and elapsed_sec and elapsed_sec > 0
                    else None
                )
                final_input_tokens = translator.input_tokens or anthro_input_estimate
                final_total_tokens = (final_input_tokens + final_output_tokens) if final_input_tokens and final_output_tokens else None
                complete_request(track_id,
                    output_tokens=final_output_tokens or 0,
                    input_tokens=final_input_tokens,
                    tokens_per_sec=tokens_per_sec,
                )
                await _record_telemetry(
                    model_id=model_name,
                    backend=proc.backend,
                    ttft_ms=ttft_ms,
                    input_tokens=final_input_tokens,
                    output_tokens=final_output_tokens,
                    total_tokens=final_total_tokens,
                    tokens_per_sec=tokens_per_sec,
                    error=stream_error_message,
                )

        return StreamingResponse(
            stream_anthropic_events(),
            media_type="text/event-stream",
            headers={"request-id": anthro_request_id},
        )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=30.0)) as client:
            response = await client.post(
                f"{backend_url}/v1/chat/completions",
                json=openai_request,
                headers={"Content-Type": "application/json"},
            )
    except httpx.HTTPError as exc:
        error_request(track_id, f"Failed to reach backend: {exc}")
        message = f"Failed to reach backend for model '{model_name}': {exc}"
        await _record_telemetry(
            model_id=model_name,
            backend=proc.backend,
            error=message,
        )
        return _anthropic_error_response(502, "api_error", message, anthro_request_id)

    if response.status_code >= 400:
        payload, raw_text = _safe_parse_json_text(response.text)
        status_code, error_type, message = _map_backend_error(
            response.status_code,
            payload,
            raw_text,
            model_name,
        )
        error_request(track_id, message)
        await _record_telemetry(
            model_id=model_name,
            backend=proc.backend,
            error=message,
        )
        return _anthropic_error_response(status_code, error_type, message, anthro_request_id)

    try:
        result = response.json()
        anthropic_result = to_anthropic_response(result, model_name)
    except (ValueError, AnthropicRequestError) as exc:
        message = exc.message if isinstance(exc, AnthropicRequestError) else f"Failed to decode backend response: {exc}"
        error_request(track_id, message)
        await _record_telemetry(
            model_id=model_name,
            backend=proc.backend,
            error=message,
        )
        return _anthropic_error_response(500, "api_error", message, anthro_request_id)

    end_time = time.monotonic()
    usage = result.get("usage", {})
    input_tokens = usage.get("prompt_tokens") or anthro_input_estimate
    output_tokens = usage.get("completion_tokens")
    total_tokens = usage.get("total_tokens") or ((input_tokens + output_tokens) if input_tokens and output_tokens else None)
    tokens_per_sec = output_tokens / (end_time - start_time) if output_tokens and end_time > start_time else None

    complete_request(track_id,
        output_tokens=output_tokens or 0,
        input_tokens=input_tokens,
        tokens_per_sec=tokens_per_sec,
    )
    await _record_telemetry(
        model_id=model_name,
        backend=proc.backend,
        ttft_ms=(end_time - start_time) * 1000,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        tokens_per_sec=tokens_per_sec,
    )
    return JSONResponse(
        content=anthropic_result,
        headers={"request-id": anthro_request_id},
    )


def _estimate_input_tokens(request_or_messages) -> int | None:
    """Estimate input token count from the request or messages.
    Used as a fallback when the backend doesn't include usage.prompt_tokens in SSE chunks.
    Rough estimate: ~4 chars per token for English text."""
    if isinstance(request_or_messages, dict):
        messages = request_or_messages.get("messages", [])
        system = request_or_messages.get("system")
    else:
        messages = request_or_messages
        system = None
    if not messages:
        return None
    total_chars = sum(len(m.get("content", "")) for m in messages if isinstance(m.get("content"), str))
    if isinstance(system, str):
        total_chars += len(system)
    if total_chars == 0:
        return None
    return max(1, total_chars // 4)


def _safe_parse_json_text(raw_text: str) -> tuple[Any, str]:
    """Best-effort JSON parsing for non-streaming backend errors."""
    raw_text = raw_text.strip()
    if not raw_text:
        return None, ""
    try:
        return json.loads(raw_text), raw_text
    except json.JSONDecodeError:
        return None, raw_text


@app.post("/v1/chat/completions")
async def chat_completions(request: dict):
    """Proxy chat completion requests to the appropriate backend.

    This is the endpoint OpenClaw talks to. It routes by model name
    to the correct backend process, collects telemetry, and streams
    responses transparently — no prompt modification.
    """
    from flow_llm.request_tracker import create_request, update_request, complete_request, error_request
    model_name = request.get("model", "")
    proc = process_manager.get_process(model_name)

    track_id = create_request(model_name, "/v1/chat/completions")

    if not proc:
        error_request(track_id, f"Model '{model_name}' is not loaded")
        raise HTTPException(404, f"Model '{model_name}' is not loaded. Available: {list(process_manager.get_all_processes().keys())}")

    start_time = time.monotonic()
    backend_url = proc.base_url

    # Inject per-model runtime config — caller values always take precedence
    _cfg = _model_configs.get(model_name, {})
    if _cfg:
        req_body = {**request}
        for _k in ("temperature", "top_p", "top_k", "presence_penalty", "repetition_penalty"):
            if _k in _cfg and _k not in req_body:
                req_body[_k] = _cfg[_k]
        if "chat_template_kwargs" in _cfg:
            _extra = dict(req_body.get("extra_body") or {})
            _ctk = dict(_extra.get("chat_template_kwargs") or {})
            _ctk.update(_cfg["chat_template_kwargs"])
            _extra["chat_template_kwargs"] = _ctk
            req_body["extra_body"] = _extra
    else:
        req_body = request

    if req_body.get("stream", False):
        # Streaming response — client must outlive the generator
        # Estimate input tokens from request messages as a fallback
        request_input_estimate = _estimate_input_tokens(req_body)

        async def stream_with_metrics():
            first_token_time = None
            total_output_tokens = 0
            input_tokens = None
            output_tokens_from_usage = None
            client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=30.0))
            stream_error = None
            try:
                async with client.stream(
                    "POST",
                    f"{backend_url}/v1/chat/completions",
                    json=req_body,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    update_request(track_id, stage="prefilling")
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                update_request(track_id, stage="sending")
                                yield "data: [DONE]\n\n"
                                break
                            try:
                                chunk = json.loads(data)
                                # Count output tokens from usage if available
                                usage = chunk.get("usage")
                                if usage:
                                    if usage.get("prompt_tokens"):
                                        input_tokens = usage["prompt_tokens"]
                                    if usage.get("completion_tokens"):
                                        output_tokens_from_usage = usage["completion_tokens"]
                                # Track first token time from content or reasoning_content deltas
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                if chunk.get("choices") and (delta.get("content") or delta.get("reasoning_content")):
                                    if first_token_time is None:
                                        first_token_time = time.monotonic()
                                        ttft = (first_token_time - start_time) * 1000
                                        update_request(track_id, stage="generating", ttft_ms=ttft, first_token_time=first_token_time)
                                    total_output_tokens += 1
                                    # Update token count for monitor (throttled in request_tracker)
                                    update_request(track_id, output_tokens=total_output_tokens)
                            except Exception:
                                pass
                            yield line + "\n"
                        elif line.strip() == "":
                            yield "\n"
                        else:
                            yield line + "\n"
            except httpx.ReadTimeout:
                stream_error = "Backend timed out — request took longer than 600s"
                error_request(track_id, stream_error)
            except Exception as exc:
                stream_error = str(exc)
                error_request(track_id, stream_error)
            finally:
                await client.aclose()
            if stream_error:
                return
            end_time = time.monotonic()
            ttft_ms = (first_token_time - start_time) * 1000 if first_token_time else None
            elapsed_sec = (end_time - start_time) if first_token_time else None
            final_output_tokens = output_tokens_from_usage or (total_output_tokens if total_output_tokens else None)
            # Fallback: estimate input tokens from request if backend didn't report them
            final_input_tokens = input_tokens or request_input_estimate
            final_total_tokens = (final_input_tokens + final_output_tokens) if final_input_tokens and final_output_tokens else None
            tokens_per_sec = (final_output_tokens / elapsed_sec) if final_output_tokens and elapsed_sec and elapsed_sec > 0 else None
            complete_request(track_id,
                output_tokens=final_output_tokens or 0,
                input_tokens=final_input_tokens,
                tokens_per_sec=tokens_per_sec,
            )
            await _record_telemetry(
                model_id=model_name,
                backend=proc.backend,
                ttft_ms=ttft_ms,
                input_tokens=final_input_tokens,
                output_tokens=final_output_tokens,
                total_tokens=final_total_tokens,
                tokens_per_sec=tokens_per_sec,
            )

        return StreamingResponse(
            stream_with_metrics(),
            media_type="text/event-stream",
        )
    else:
        # Non-streaming response — use long timeout for deep thinking/reasoning
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=30.0)) as client:
                response = await client.post(
                    f"{backend_url}/v1/chat/completions",
                    json=req_body,
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

                complete_request(track_id,
                    output_tokens=output_tokens or 0,
                    input_tokens=input_tokens,
                    tokens_per_sec=tokens_per_sec,
                )
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
        except httpx.ReadTimeout:
            error_request(track_id, "Backend timed out — request took longer than 600s")
            return JSONResponse(
                status_code=504,
                content={"error": {"message": "Backend timed out", "type": "timeout_error"}},
            )
        except Exception as exc:
            error_request(track_id, str(exc))
            return JSONResponse(
                status_code=502,
                content={"error": {"message": f"Proxy error: {str(exc)}", "type": "proxy_error"}},
            )


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
            "owned_by": "flow",
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


def _looks_like_mlx_model_dir(path: Path) -> bool:
    """Best-effort detection for an MLX model repo on disk."""
    if not path.is_dir():
        return False
    has_weights = any(path.glob("*.safetensors"))
    has_config = (path / "config.json").exists()
    has_tokenizer = (path / "tokenizer.json").exists() or (path / "tokenizer.model").exists()
    return has_weights and has_config and has_tokenizer


# --- Health ---


class UpdateSettingsRequest(BaseModel):
    models_dir: Optional[str] = None
    port: Optional[int] = None
    default_ctx_size: Optional[int] = None
    default_flash_attn: Optional[str] = None
    default_cache_type_k: Optional[str] = None
    default_cache_type_v: Optional[str] = None
    default_gpu_layers: Optional[int] = None
    default_n_parallel: Optional[int] = None
    auto_update_backends: Optional[bool] = None


@app.get("/api/settings")
async def get_settings():
    """Get current default settings for model loading."""
    return {
        "port": settings.port,
        "default_ctx_size": settings.default_ctx_size,
        "default_flash_attn": settings.default_flash_attn,
        "default_cache_type_k": settings.default_cache_type_k,
        "default_cache_type_v": settings.default_cache_type_v,
        "default_gpu_layers": settings.default_gpu_layers,
        "default_n_parallel": settings.default_n_parallel,
        "models_dir": str(settings.models_dir),
        "auto_update_backends": settings.auto_update_backends,
    }


@app.put("/api/settings")
async def update_settings(request: UpdateSettingsRequest):
    """Update default settings for model loading."""
    if request.models_dir is not None:
        if not request.models_dir.strip():
            raise HTTPException(400, "models_dir cannot be empty")
        settings.models_dir = Path(request.models_dir).expanduser()
        settings.models_dir.mkdir(parents=True, exist_ok=True)
    if request.port is not None:
        if request.port < 1 or request.port > 65535:
            raise HTTPException(400, "port must be between 1 and 65535")
        settings.port = request.port
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
    if request.auto_update_backends is not None:
        settings.auto_update_backends = request.auto_update_backends
    settings.save_to_disk()
    return {"status": "ok"}


@app.get("/api/backend-versions")
async def get_backend_versions():
    """Get current and latest versions of llama.cpp and mlx-openai-server."""
    from flow_llm.updater import get_versions
    versions = get_versions()
    return {k: v.to_dict() for k, v in versions.items()}


@app.post("/api/check-updates")
async def check_updates_now():
    """Trigger an immediate version check (and optional update) of backends."""
    from flow_llm.updater import check_and_autoupdate
    asyncio.create_task(check_and_autoupdate(auto_update=settings.auto_update_backends))
    return {"status": "checking"}


@app.post("/api/update-backend/{backend}")
async def update_backend(backend: str):
    """Manually trigger an update for a specific backend (llamacpp or mlx)."""
    from flow_llm.updater import update_llamacpp, update_mlx
    if backend == "llamacpp":
        asyncio.create_task(update_llamacpp())
    elif backend == "mlx":
        asyncio.create_task(update_mlx())
    else:
        raise HTTPException(400, f"Unknown backend: {backend}")
    return {"status": "updating"}


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    running = process_manager.get_all_processes()
    return {
        "status": "ok",
        "running_models": len(running),
        "models": list(running.keys()),
    }


@app.get("/api/processing-progress")
async def processing_progress():
    """Get processing progress for all models currently processing."""
    from flow_llm.process_manager import get_processing_progress
    running = process_manager.get_all_processes()
    progress = {}
    for model_id in running:
        p = get_processing_progress(model_id)
        if p is not None:
            progress[model_id] = p
    return {"progress": progress}


@app.get("/api/logs")
async def get_logs(model_id: Optional[str] = None, lines: int = 200):
    """Get recent backend process logs."""
    from flow_llm.process_manager import get_logs as get_pm_logs
    logs = get_pm_logs(model_id=model_id, lines=min(lines, 2000))
    return {"logs": logs}


def _parse_prometheus_metrics(text: str) -> dict[str, float]:
    """Parse Prometheus text format into a flat dict of metric name -> value."""
    import re
    metrics: dict[str, float] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Strip labels: "metric{label=value} 1.0" → "metric" -> 1.0
        m = re.match(r'^([a-zA-Z_:][a-zA-Z0-9_:]*?)(?:\{[^}]*\})?\s+([-\d.eE+]+)', line)
        if m:
            try:
                metrics[m.group(1)] = float(m.group(2))
            except ValueError:
                pass
    return metrics


@app.get("/api/model-activity")
async def model_activity():
    """Get live per-model activity: per-slot prefill/generation state, metrics, and active requests."""
    from flow_llm.process_manager import get_slot_states
    from flow_llm.request_tracker import get_requests_for_model, prune_completed

    prune_completed()
    running = process_manager.get_all_processes()
    activity: dict[str, dict] = {}

    async with httpx.AsyncClient(timeout=1.0) as client:
        for model_id, proc in running.items():
            port = getattr(proc, "port", None)

            # Per-slot state from log parsing (prefill progress, generating)
            slots = get_slot_states(model_id)
            slots_list = [
                {"slot_id": sid, "state": s["state"], "progress": s["progress"]}
                for sid, s in sorted(slots.items())
                if s["state"] != "idle"
            ]

            info: dict = {
                "slots": slots_list,
                "slots_processing": None,
                "slots_deferred": None,
                "tokens_per_sec": None,
                "kv_cache_usage": None,
                "requests": get_requests_for_model(model_id),
            }

            # Supplement with Prometheus metrics from llama-server
            if port:
                try:
                    resp = await client.get(f"http://127.0.0.1:{port}/metrics")
                    if resp.status_code == 200:
                        m = _parse_prometheus_metrics(resp.text)
                        info["slots_processing"] = int(m.get("llamacpp:requests_processing", 0))
                        info["slots_deferred"] = int(m.get("llamacpp:requests_deferred", 0))
                        info["tokens_per_sec"] = (
                            m.get("llamacpp:tokens_per_second")
                            or m.get("llamacpp:token_generation_speed")
                        )
                        info["kv_cache_usage"] = m.get("llamacpp:kv_cache_usage_ratio")
                except Exception:
                    pass

            activity[model_id] = info

    return {"activity": activity}


@app.get("/api/requests")
async def get_requests():
    """Get all active tracked requests (polling fallback for WebSocket)."""
    from flow_llm.request_tracker import get_all_active, prune_completed, clear_stuck
    prune_completed()
    clear_stuck()
    return {"requests": get_all_active()}


@app.post("/api/requests/clear-stuck")
async def api_clear_stuck(max_age: int = 120):
    """Clear requests stuck in queued/generating/prefilling/sending for too long."""
    from flow_llm.request_tracker import clear_stuck
    count = clear_stuck(max_age_seconds=max_age)
    return {"cleared": count}


# --- Serve frontend ---


if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIST / "assets")), name="assets")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve static files from dist/ first, then fall back to React SPA."""
    if full_path.startswith(("api/", "v1/", "ws")):
        raise HTTPException(404)

    # Serve actual static files (favicon.svg, icons.svg, etc.)
    file_path = WEB_DIST / full_path
    if file_path.is_file() and not full_path.startswith("assets/"):
        return FileResponse(str(file_path))

    # SPA fallback — serve index.html for client-side routing
    index_path = WEB_DIST / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    raise HTTPException(404, "Frontend not built. Run: cd web && npm run build")


def main():
    """Run the Flow LLM server."""
    import uvicorn
    uvicorn.run(
        "flow_llm.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
