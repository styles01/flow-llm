"""Process manager for llama.cpp and mlx-openai-server backends."""

import asyncio
import logging
import subprocess
from pathlib import Path
from typing import Optional

from psutil import Process

from james.config import settings, DEFAULT_LLAMACPP_HOST

logger = logging.getLogger(__name__)


class BackendProcess:
    """Manages a single backend server process (llama.cpp or mlx-openai-server)."""

    def __init__(
        self,
        model_id: str,
        backend: str,
        port: int,
        model_path: str,
        ctx_size: int = settings.default_ctx_size,
        flash_attn: str = settings.default_flash_attn,
        cache_type_k: str = settings.default_cache_type_k,
        cache_type_v: str = settings.default_cache_type_v,
        gpu_layers: int = settings.default_gpu_layers,
        n_parallel: int = settings.default_n_parallel,
        host: str = DEFAULT_LLAMACPP_HOST
    ):
        self.model_id = model_id
        self.backend = backend  # "gguf" or "mlx"
        self.port = port
        self.model_path = model_path
        self.ctx_size = ctx_size
        self.flash_attn = flash_attn
        self.cache_type_k = cache_type_k
        self.cache_type_v = cache_type_v
        self.gpu_layers = gpu_layers
        self.n_parallel = n_parallel
        self.host = host
        self.process: Optional[subprocess.Popen] = None
        self._health_task: Optional[asyncio.Task] = None

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
            return [
                "mlx-openai-server",
                "launch",
                "--model-path", self.model_path,
                "--model-type", "lm",
                "--host", self.host,
                "--port", str(self.port),
            ]
        else:
            raise ValueError(f"Unknown backend: {self.backend}")

    async def start(self) -> bool:
        """Start the backend process. Returns True if successful."""
        cmd = self.build_command()
        logger.info(f"Starting {self.backend} backend: {' '.join(cmd)}")

        try:
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            # Wait briefly and check if process died immediately
            await asyncio.sleep(2)
            if self.process.poll() is not None:
                stderr = self.process.stderr.read().decode() if self.process.stderr else ""
                logger.error(f"Backend process died immediately: {stderr}")
                return False

            logger.info(f"Backend started: model={self.model_id} port={self.port} pid={self.process.pid}")
            return True
        except Exception as e:
            logger.error(f"Failed to start backend: {e}")
            return False

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



class ProcessManager:
    """Manages all backend processes."""

    def __init__(self):
        self._processes: dict[str, BackendProcess] = {}  # model_id -> BackendProcess
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
        ctx_size: int = settings.default_ctx_size,
        flash_attn: str = settings.default_flash_attn,
        cache_type_k: str = settings.default_cache_type_k,
        cache_type_v: str = settings.default_cache_type_v,
        gpu_layers: int = settings.default_gpu_layers,
        n_parallel: int = settings.default_n_parallel,
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
        )

        success = await proc.start()
        if not success:
            self._free_port(port)
            raise RuntimeError(f"Failed to start model {model_id}")

        self._processes[model_id] = proc
        self._port_alloc[port] = model_id
        return proc

    async def stop_model(self, model_id: str) -> bool:
        """Stop a running model."""
        if model_id not in self._processes:
            return False

        proc = self._processes[model_id]
        success = await proc.stop()
        self._free_port(proc.port)
        del self._processes[model_id]
        return success

    def get_process(self, model_id: str) -> Optional[BackendProcess]:
        """Get the process for a model."""
        return self._processes.get(model_id)

    def get_all_processes(self) -> dict[str, BackendProcess]:
        """Get all running processes."""
        return {k: v for k, v in self._processes.items() if v.is_running()}

    async def stop_all(self):
        """Stop all running backends."""
        for model_id in list(self._processes.keys()):
            await self.stop_model(model_id)


# Global process manager
process_manager = ProcessManager()