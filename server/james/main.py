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
from pydantic import BaseModel

from james.config import settings
from james.database import Model, Telemetry, init_db
from james.hardware import get_hardware_info, estimate_model_memory
from james.hf_client import HuggingFaceClient
from james.process_manager import process_manager, BackendProcess
from james.template_validator import validate_model_dir

logger = logging.getLogger(__name__)

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
    model_id: str
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    global db_session_factory, hf_client

    # Startup
    settings.ensure_dirs()
    db_session_factory = init_db(settings.db_path)
    hf_client = HuggingFaceClient(token=None)  # TODO: load from config
    logger.info("JAMES started — data dir: %s", settings.data_dir)

    yield

    # Shutdown
    logger.info("Shutting down backends...")
    await process_manager.stop_all()
    logger.info("JAMES stopped.")


# --- App ---


app = FastAPI(
    title="JAMES",
    description="Just A Model Execution Server — local LLM gateway for OpenClaw",
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

        # Generate model ID
        model_id = request.hf_id.replace("/", "__")
        if request.filename:
            model_id += f"__{request.filename}"

        # Save to registry
        model = Model(
            id=model_id,
            name=request.filename or request.hf_id,
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

        # Determine model path
        model_path = model.gguf_file or model.mlx_path
        if not model_path or not Path(model_path).exists():
            raise HTTPException(400, f"Model file not found: {model_path}")

        # Check memory
        hw = get_hardware_info()
        est_memory = estimate_model_memory(
            model.size_gb or 0,
            request.ctx_size,
            request.cache_type_k,
        )
        if est_memory > hw.memory_available_gb:
            raise HTTPException(
                400,
                f"Insufficient memory: need {est_memory}GB, have {hw.memory_available_gb:.1f}GB available",
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
    """Unload a model (stop its backend process)."""
    session = db_session_factory()
    try:
        model = session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise HTTPException(404, f"Model {model_id} not found")
        if model.status != "running":
            raise HTTPException(400, f"Model {model_id} is not running")

        await process_manager.stop_model(model_id)

        model.status = "available"
        model.port = None
        model.pid = None
        session.commit()

        await broadcast("model_unloaded", {"model_id": model_id})

        return {"model_id": model_id, "status": "available"}
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
    """Get details for a HuggingFace model."""
    if not hf_client:
        raise HTTPException(500, "HuggingFace client not initialized")

    details = hf_client.get_model_details(model_id)
    if not details:
        raise HTTPException(404, f"Model {model_id} not found on HuggingFace")

    gguf_files = hf_client.list_gguf_files(model_id)
    mlx_versions = hf_client.list_mlx_files(model_id)

    return {
        **details,
        "gguf_files": gguf_files,
        "mlx_versions": mlx_versions,
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

    async with httpx.AsyncClient(timeout=300.0) as client:
        if request.get("stream", False):
            # Streaming response — collect telemetry while streaming
            async def stream_with_metrics():
                first_token_time = None
                total_output_tokens = 0

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
                                yield line + "\n\n"
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
                        yield line + "\n\n"

                # Record telemetry
                ttft_ms = (first_token_time - start_time) * 1000 if first_token_time else None
                await _record_telemetry(
                    model_id=model_name,
                    backend=proc.backend,
                    ttft_ms=ttft_ms,
                    input_tokens=request.get("max_tokens"),
                    output_tokens=total_output_tokens if total_output_tokens else None,
                )

            from fastapi.responses import StreamingResponse
            return StreamingResponse(
                stream_with_metrics(),
                media_type="text/event-stream",
            )
        else:
            # Non-streaming response
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


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    running = process_manager.get_all_processes()
    return {
        "status": "ok",
        "running_models": len(running),
        "models": list(running.keys()),
    }


def main():
    """Run the JAMES server."""
    import uvicorn
    uvicorn.run(
        "james.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()