"""Process manager for llama.cpp and mlx-openai-server backends."""

import asyncio
import logging
import re
import subprocess
from collections import deque
from pathlib import Path
from typing import Optional

from psutil import Process

from james.config import settings, DEFAULT_LLAMACPP_HOST

logger = logging.getLogger(__name__)

# Progress tracking for model processing (prefill/generation)
_processing_progress: dict[str, float] = {}  # model_id -> progress (0.0-1.0)

# Log buffer for backend processes (rotating buffer, max 2000 lines per model)
_log_buffers: dict[str, deque[str]] = {}
_MAX_LOG_LINES = 2000


def get_processing_progress(model_id: str) -> Optional[float]:
    """Get the processing progress for a model (0.0 to 1.0), or None if not processing."""
    return _processing_progress.get(model_id)


def reset_processing_progress(model_id: str):
    """Reset processing progress for a model (call when a new request starts)."""
    _processing_progress[model_id] = 0.0


def append_log(model_id: str, line: str):
    """Append a log line to the rotating buffer for a model."""
    if model_id not in _log_buffers:
        _log_buffers[model_id] = deque(maxlen=_MAX_LOG_LINES)
    _log_buffers[model_id].append(line)


def get_logs(model_id: str = None, lines: int = 200) -> list[str]:
    """Get recent log lines. If model_id is None, returns all logs merged by timestamp.
    If model_id is specified, returns only that model's logs."""
    if model_id:
        buf = _log_buffers.get(model_id, deque())
        return list(buf)[-lines:]
    # Merge all model logs
    all_logs = []
    for mid, buf in _log_buffers.items():
        for line in buf:
            all_logs.append(f"[{mid}] {line}")
    return all_logs[-lines:]


class BackendProcess:
    """Manages a single backend server process (llama.cpp or mlx-openai-server)."""

    def __init__(
        self,
        model_id: str,
        backend: str,
        port: int,
        model_path: str,
        # GGUF params
        ctx_size: int = settings.default_ctx_size,
        flash_attn: str = settings.default_flash_attn,
        cache_type_k: str = settings.default_cache_type_k,
        cache_type_v: str = settings.default_cache_type_v,
        gpu_layers: int = settings.default_gpu_layers,
        n_parallel: int = settings.default_n_parallel,
        # MLX params
        mlx_context_length: int = 0,
        mlx_prompt_cache_size: int = 10,
        mlx_enable_auto_tool_choice: bool = False,
        mlx_reasoning_parser: str = "",
        mlx_chat_template_file: str = "",
        mlx_trust_remote_code: bool = False,
        host: str = DEFAULT_LLAMACPP_HOST
    ):
        self.model_id = model_id
        self.backend = backend  # "gguf" or "mlx"
        self.port = port
        self.model_path = model_path
        # GGUF
        self.ctx_size = ctx_size
        self.flash_attn = flash_attn
        self.cache_type_k = cache_type_k
        self.cache_type_v = cache_type_v
        self.gpu_layers = gpu_layers
        self.n_parallel = n_parallel
        # MLX
        self.mlx_context_length = mlx_context_length
        self.mlx_prompt_cache_size = mlx_prompt_cache_size
        self.mlx_enable_auto_tool_choice = mlx_enable_auto_tool_choice
        self.mlx_reasoning_parser = mlx_reasoning_parser
        self.mlx_chat_template_file = mlx_chat_template_file
        self.mlx_trust_remote_code = mlx_trust_remote_code
        self.host = host
        self.process: Optional[subprocess.Popen] = None
        self._health_task: Optional[asyncio.Task] = None

    def _monitor_stderr(self):
        """Read stderr from the backend process and parse progress lines."""
        if not self.process or not self.process.stderr:
            return
        try:
            for line in iter(self.process.stderr.readline, b''):
                if not line:
                    break
                text = line.decode(errors='replace').strip()
                if not text:
                    continue
                # Store in log buffer
                append_log(self.model_id, text)
                logger.debug(f"[{self.model_id}] stderr: {text}")
                # llama-server prefill progress: "llama_progress: 0.42" or "prefill: 42%"
                m = re.search(r'(?:llama_progress|prefill)[:\s]+(\d+\.?\d*)', text, re.IGNORECASE)
                if m:
                    val = float(m.group(1))
                    # Normalize: if > 1, assume it's a percentage (e.g., 42)
                    progress = val / 100.0 if val > 1.0 else val
                    _processing_progress[self.model_id] = min(progress, 1.0)
                    # Broadcast via WebSocket
                    try:
                        import asyncio
                        from james.main import broadcast
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            loop.create_task(broadcast("processing_progress", {
                                "model_id": self.model_id,
                                "progress": _processing_progress[self.model_id],
                            }))
                    except Exception:
                        pass
                # Also detect when processing starts/resets
                if 'load model' in text.lower() or 'processing' in text.lower():
                    if self.model_id not in _processing_progress:
                        _processing_progress[self.model_id] = 0.0
        except Exception as e:
            logger.debug(f"stderr monitor for {self.model_id} ended: {e}")
        finally:
            # Clean up progress when process exits
            _processing_progress.pop(self.model_id, None)

    def _monitor_stdout(self):
        """Read stdout from the backend process and store in log buffer."""
        if not self.process or not self.process.stdout:
            return
        try:
            for line in iter(self.process.stdout.readline, b''):
                if not line:
                    break
                text = line.decode(errors='replace').strip()
                if not text:
                    continue
                append_log(self.model_id, text)
        except Exception as e:
            logger.debug(f"stdout monitor for {self.model_id} ended: {e}")

    def build_command(self) -> list[str]:
        """Build the command to start the backend process."""
        if self.backend == "gguf":
            return [
                "llama-server",
                "--model", self.model_path,
                "--host", self.host,
                "--port", str(self.port),
                "--n-gpu-layers", str(self.gpu_layers),
                "--ctx-size", str(self.ctx_size),
                "--parallel", str(self.n_parallel),
                "--cont-batching",
                "--flash-attn", self.flash_attn,
                "--cache-type-k", self.cache_type_k,
                "--cache-type-v", self.cache_type_v,
                "--metrics",
            ]
        elif self.backend == "mlx":
            cmd = [
                "mlx-openai-server",
                "launch",
                "--model-path", self.model_path,
                "--model-type", "lm",
                "--host", self.host,
                "--port", str(self.port),
            ]
            if self.mlx_context_length > 0:
                cmd.extend(["--context-length", str(self.mlx_context_length)])
            if self.mlx_prompt_cache_size > 0:
                cmd.extend(["--prompt-cache-size", str(self.mlx_prompt_cache_size)])
            if self.mlx_enable_auto_tool_choice:
                cmd.append("--enable-auto-tool-choice")
            if self.mlx_reasoning_parser:
                cmd.extend(["--reasoning-parser", self.mlx_reasoning_parser])
            if self.mlx_chat_template_file:
                cmd.extend(["--chat-template-file", self.mlx_chat_template_file])
            if self.mlx_trust_remote_code:
                cmd.append("--trust-remote-code")
            return cmd
        else:
            raise ValueError(f"Unknown backend: {self.backend}")

    async def start(self) -> bool:
        """Start the backend process. Returns True if successful."""
        cmd = self.build_command()
        logger.info(f"Starting {self.backend} backend: {' '.join(cmd)}")
        print(f"[Flow] Starting {self.backend} backend: {' '.join(cmd)}")

        # Check if the command exists
        import shutil
        if not shutil.which(cmd[0]):
            error_msg = f"Backend command not found: {cmd[0]}. Install it first."
            if self.backend == "mlx":
                error_msg = f"mlx-openai-server is not installed. Install with: pip install mlx-openai-server"
            elif self.backend == "gguf":
                error_msg = f"llama-server is not installed. Install llama.cpp first."
            logger.error(error_msg)
            print(f"[Flow] {error_msg}")
            raise RuntimeError(error_msg)

        try:
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            # Start stderr monitor in background thread
            import threading
            monitor = threading.Thread(target=self._monitor_stderr, daemon=True)
            monitor.start()
            # Start stdout monitor in background thread
            stdout_monitor = threading.Thread(target=self._monitor_stdout, daemon=True)
            stdout_monitor.start()

            # Wait briefly and check if process died immediately
            await asyncio.sleep(2)
            if self.process.poll() is not None:
                stderr = self.process.stderr.read().decode() if self.process.stderr else ""
                logger.error(f"Backend process died immediately: {stderr}")
                print(f"[Flow] Backend process died immediately: {stderr[:500]}")
                raise RuntimeError(f"Backend process exited immediately: {stderr[:300]}")

            logger.info(f"Backend started: model={self.model_id} port={self.port} pid={self.process.pid}")
            print(f"[Flow] Backend started: model={self.model_id} port={self.port} pid={self.process.pid}")
            return True
        except RuntimeError:
            raise
        except Exception as e:
            logger.error(f"Failed to start backend: {e}")
            print(f"[Flow] Failed to start backend: {e}")
            raise RuntimeError(f"Failed to start {self.backend} backend: {e}")

    async def stop(self) -> bool:
        """Stop the backend process gracefully."""
        if self.process is None:
            return True

        logger.info(f"Stopping backend: model={self.model_id} pid={self.process.pid}")
        try:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
            logger.info(f"Backend stopped: model={self.model_id}")
            self.process = None
            return True
        except Exception as e:
            logger.error(f"Failed to stop backend: {e}")
            return False

    def is_running(self) -> bool:
        """Check if the backend process is still alive."""
        if self.process is None:
            return False
        return self.process.poll() is None

    def get_pid(self) -> Optional[int]:
        """Get the PID of the backend process."""
        if self.process is None:
            return None
        return self.process.pid

    @property
    def base_url(self) -> str:
        """Get the base URL for this backend."""
        return f"http://{self.host}:{self.port}"



class ExternalProcess:
    """Represents an already-running backend not started by JAMES."""

    def __init__(self, model_id: str, backend: str, base_url: str, port: int):
        self.model_id = model_id
        self.backend = backend
        self.base_url = base_url
        self.port = port
        self._external = True

    def is_running(self) -> bool:
        """Check if the external backend is still alive."""
        import httpx
        try:
            r = httpx.get(f"{self.base_url}/health", timeout=3)
            return r.status_code == 200
        except Exception:
            # Try /v1/models as fallback
            try:
                r = httpx.get(f"{self.base_url}/v1/models", timeout=3)
                return r.status_code == 200
            except Exception:
                return False

    def get_pid(self) -> Optional[int]:
        """External processes don't have a managed PID."""
        return None


class ProcessManager:
    """Manages all backend processes."""

    def __init__(self):
        self._processes: dict[str, BackendProcess] = {}  # model_id -> BackendProcess
        self._external: dict[str, ExternalProcess] = {}  # model_id -> ExternalProcess
        self._port_alloc: dict[int, str] = {}  # port -> model_id

    def _allocate_port(self, backend: str) -> int:
        """Allocate an available port for a backend."""
        if backend == "gguf":
            port_range = settings.llamacpp_port_range
        else:
            port_range = settings.mlx_port_range

        for port in range(port_range[0], port_range[1] + 1):
            if port not in self._port_alloc:
                return port
        raise RuntimeError(f"No available ports for {backend} backend")

    def _free_port(self, port: int):
        """Free a previously allocated port."""
        self._port_alloc.pop(port, None)

    async def start_model(
        self,
        model_id: str,
        backend: str,
        model_path: str,
        # GGUF params
        ctx_size: int = settings.default_ctx_size,
        flash_attn: str = settings.default_flash_attn,
        cache_type_k: str = settings.default_cache_type_k,
        cache_type_v: str = settings.default_cache_type_v,
        gpu_layers: int = settings.default_gpu_layers,
        n_parallel: int = settings.default_n_parallel,
        # MLX params
        mlx_context_length: int = 0,
        mlx_prompt_cache_size: int = 10,
        mlx_enable_auto_tool_choice: bool = False,
        mlx_reasoning_parser: str = "",
        mlx_chat_template_file: str = "",
        mlx_trust_remote_code: bool = False,
    ) -> BackendProcess:
        """Start a model on a backend. Returns the BackendProcess."""
        if model_id in self._processes:
            existing = self._processes[model_id]
            if existing.is_running():
                raise ValueError(f"Model {model_id} is already running on port {existing.port}")
            # Dead process, clean up
            self._free_port(existing.port)
            del self._processes[model_id]

        port = self._allocate_port(backend)
        proc = BackendProcess(
            model_id=model_id,
            backend=backend,
            port=port,
            model_path=model_path,
            ctx_size=ctx_size,
            flash_attn=flash_attn,
            cache_type_k=cache_type_k,
            cache_type_v=cache_type_v,
            gpu_layers=gpu_layers,
            n_parallel=n_parallel,
            mlx_context_length=mlx_context_length,
            mlx_prompt_cache_size=mlx_prompt_cache_size,
            mlx_enable_auto_tool_choice=mlx_enable_auto_tool_choice,
            mlx_reasoning_parser=mlx_reasoning_parser,
            mlx_chat_template_file=mlx_chat_template_file,
            mlx_trust_remote_code=mlx_trust_remote_code,
        )

        try:
            await proc.start()
        except Exception:
            self._free_port(port)
            raise

        self._processes[model_id] = proc
        self._port_alloc[port] = model_id
        return proc

    async def stop_model(self, model_id: str) -> bool:
        """Stop a running model. For managed processes, kills the subprocess.
        For external processes, kills whatever is listening on that port."""
        print(f"[JAMES] stop_model('{model_id}') — external={list(self._external.keys())} processes={list(self._processes.keys())}")
        logger.info(f"stop_model called for {model_id}, external={list(self._external.keys())}, processes={list(self._processes.keys())}")

        # External process — find and kill the process on that port
        if model_id in self._external:
            ext = self._external[model_id]
            port = ext.port
            del self._external[model_id]
            print(f"[JAMES] Killing external backend on port {port}")
            logger.info(f"Unregistering external backend: model={model_id} port={port}")

            # Kill the process listening on that port
            killed = await self._kill_port(port)
            if killed:
                print(f"[JAMES] Successfully killed process on port {port}")
                logger.info(f"Killed process on port {port}")
            else:
                print(f"[JAMES] WARNING: No process found on port {port} to kill")
                logger.warning(f"No process found on port {port} to kill")
            return True

        if model_id not in self._processes:
            print(f"[JAMES] Model '{model_id}' not found in any process list")
            return False

        proc = self._processes[model_id]
        success = await proc.stop()
        self._free_port(proc.port)
        del self._processes[model_id]
        return success

    def register_external(self, model_id: str, backend: str, base_url: str, port: int) -> ExternalProcess:
        """Register an already-running backend process not started by JAMES."""
        ext = ExternalProcess(model_id=model_id, backend=backend, base_url=base_url, port=port)
        self._external[model_id] = ext
        logger.info(f"Registered external backend: model={model_id} base_url={base_url}")
        return ext

    def get_process(self, model_id: str) -> Optional[BackendProcess | ExternalProcess]:
        """Get the process for a model."""
        if model_id in self._external:
            return self._external[model_id]
        return self._processes.get(model_id)

    def get_all_processes(self) -> dict[str, BackendProcess | ExternalProcess]:
        """Get all running processes (managed + external)."""
        result = {}
        result.update({k: v for k, v in self._processes.items() if v.is_running()})
        result.update({k: v for k, v in self._external.items() if v.is_running()})
        return result


    async def stop_all(self):
        """Stop all running backends."""
        for model_id in list(self._processes.keys()):
            await self.stop_model(model_id)
        for model_id in list(self._external.keys()):
            await self.stop_model(model_id)

    async def _kill_port(self, port: int) -> bool:
        """Kill whatever process is listening on the given port."""
        import asyncio
        try:
            # Find PID listening on this port
            result = await asyncio.create_subprocess_exec(
                "lsof", "-ti", f":{port}", "-sTCP:LISTEN",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await result.communicate()
            pids = stdout.decode().strip().split('\n')
            pids = [p.strip() for p in pids if p.strip()]

            print(f"[JAMES] _kill_port({port}): found PIDs={pids}")

            if not pids:
                return False

            # First try SIGTERM (graceful)
            for pid in pids:
                try:
                    await asyncio.create_subprocess_exec("kill", pid)
                    logger.info(f"Sent SIGTERM to PID {pid} on port {port}")
                except Exception as e:
                    logger.error(f"Failed to kill PID {pid}: {e}")

            # Wait and check if it died
            await asyncio.sleep(2)
            check = await asyncio.create_subprocess_exec(
                "lsof", "-ti", f":{port}", "-sTCP:LISTEN",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await check.communicate()
            remaining = stdout.decode().strip().split('\n')
            remaining = [p.strip() for p in remaining if p.strip()]

            # Escalate to SIGKILL if still alive
            if remaining:
                for pid in remaining:
                    try:
                        await asyncio.create_subprocess_exec("kill", "-9", pid)
                        logger.info(f"Sent SIGKILL to PID {pid} on port {port}")
                    except Exception as e:
                        logger.error(f"Failed to kill -9 PID {pid}: {e}")

                await asyncio.sleep(2)
                # Final check
                check2 = await asyncio.create_subprocess_exec(
                    "lsof", "-ti", f":{port}", "-sTCP:LISTEN",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await check2.communicate()
                return not stdout.decode().strip()

            return True
        except Exception as e:
            logger.error(f"Error killing port {port}: {e}")
            return False


# Global process manager
process_manager = ProcessManager()