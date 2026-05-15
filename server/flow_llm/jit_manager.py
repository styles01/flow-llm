"""JIT (Just-In-Time) model loading manager for Flow LLM.

Tracks per-model access times, schedules cooldown-based auto-unload,
and provides eviction candidates for the memory circuit breaker.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ModelAccessInfo:
    model_id: str
    last_access_time: float = field(default_factory=time.monotonic)
    cooldown_task: asyncio.Task | None = None
    is_external: bool = False

    def __post_init__(self):
        # Per-model lock to prevent concurrent JIT loads of the same model
        self.load_lock: asyncio.Lock = asyncio.Lock()


class JITManager:
    """Manages JIT model loading, cooldown scheduling, and eviction logic."""

    def __init__(self):
        self._access: dict[str, ModelAccessInfo] = {}
        self._access_lock: asyncio.Lock = asyncio.Lock()
        self._jit_enabled: bool = True
        self._cooldown_enabled: bool = True
        self._cooldown_seconds: int = 300
        # Track unloading models to prevent JIT from re-loading during unload
        self._unloading: dict[str, asyncio.Lock] = {}

    # -- Config ---------------------------------------------------------

    def set_config(self, *, enabled: bool, cooldown_enabled: bool, cooldown_seconds: int):
        self._jit_enabled = enabled
        self._cooldown_enabled = cooldown_enabled
        self._cooldown_seconds = cooldown_seconds

    def get_config(self) -> dict:
        return {
            "jit_enabled": self._jit_enabled,
            "jit_cooldown_enabled": self._cooldown_enabled,
            "jit_cooldown_seconds": self._cooldown_seconds,
        }

    @property
    def jit_enabled(self) -> bool:
        return self._jit_enabled

    @property
    def cooldown_enabled(self) -> bool:
        return self._cooldown_enabled

    @property
    def cooldown_seconds(self) -> int:
        return self._cooldown_seconds

    # -- Access tracking ------------------------------------------------

    def _get_or_create_info(self, model_id: str) -> ModelAccessInfo:
        if model_id not in self._access:
            self._access[model_id] = ModelAccessInfo(model_id=model_id)
        return self._access[model_id]

    async def record_access(self, model_id: str):
        """Record that a model was accessed. Cancels any pending cooldown."""
        info = self._get_or_create_info(model_id)
        async with self._access_lock:
            info.last_access_time = time.monotonic()
            if info.cooldown_task is not None:
                info.cooldown_task.cancel()
                info.cooldown_task = None

    async def start_cooldown(self, model_id: str):
        """Start the cooldown timer for a model. When it fires, the model is
        unloaded unless a new access occurred in the meantime or there are
        active in-flight requests."""
        if not self._cooldown_enabled:
            return

        info = self._get_or_create_info(model_id)
        if info.is_external:
            return

        # Cancel any existing cooldown
        if info.cooldown_task is not None:
            info.cooldown_task.cancel()

        access_snapshot = info.last_access_time

        async def _cooldown_coro():
            await asyncio.sleep(self._cooldown_seconds)

            # Re-check cooldown is still enabled
            if not self._cooldown_enabled:
                return

            # Re-check no new access happened during the sleep
            if info.last_access_time != access_snapshot:
                return

            # Re-check no active in-flight requests
            try:
                from flow_llm.request_tracker import _model_requests
                if _model_requests.get(model_id):
                    return
            except ImportError:
                pass

            # Proceed with unload
            logger.info(f"Cooldown expired for '{model_id}', unloading")
            await self._do_unload(model_id)

        info.cooldown_task = asyncio.ensure_future(_cooldown_coro())

    async def cancel_cooldown(self, model_id: str):
        """Cancel any pending cooldown for a model."""
        info = self._access.get(model_id)
        if info is not None and info.cooldown_task is not None:
            info.cooldown_task.cancel()
            info.cooldown_task = None

    # -- Eviction -------------------------------------------------------

    def get_eviction_candidates(self) -> list[str]:
        """Return eligible model IDs for eviction, sorted oldest-first.

        Excludes: external processes, models with active cooldown tasks,
        models currently loading, and models with active in-flight requests.
        """
        try:
            from flow_llm.request_tracker import _model_requests
        except ImportError:
            _model_requests = {}

        candidates: list[tuple[str, float]] = []
        for model_id, info in self._access.items():
            if info.is_external:
                continue
            if info.cooldown_task is not None and not info.cooldown_task.done():
                continue
            if info.load_lock.locked():
                continue
            if _model_requests.get(model_id):
                continue
            candidates.append((model_id, info.last_access_time))

        candidates.sort(key=lambda x: x[1])
        return [c[0] for c in candidates]

    # -- State queries --------------------------------------------------

    def get_model_state(self, model_id: str) -> str:
        """Return the JIT state for a model."""
        info = self._access.get(model_id)
        if info is None:
            return "not_tracked"
        if info.load_lock.locked():
            return "loading"
        if info.cooldown_task is not None and not info.cooldown_task.done():
            return "cooling_down"
        return "active"

    def is_unloading(self, model_id: str) -> bool:
        """Check if a model is being explicitly unloaded (JIT should back off)."""
        lock = self._unloading.get(model_id)
        return lock is not None and lock.locked()

    async def mark_unloading(self, model_id: str):
        """Mark a model as being unloaded. Returns an async context manager
        that auto-clears when the unload completes."""
        if model_id not in self._unloading:
            self._unloading[model_id] = asyncio.Lock()
        await self._unloading[model_id].acquire()

    def unmark_unloading(self, model_id: str):
        """Release the unloading lock for a model."""
        lock = self._unloading.get(model_id)
        if lock is not None and lock.locked():
            lock.release()

    # -- External models ------------------------------------------------

    async def track_external(self, model_id: str):
        """Mark a model as external — never auto-unloaded or evicted."""
        info = self._get_or_create_info(model_id)
        info.is_external = True

    # -- Unload helper --------------------------------------------------

    async def _do_unload(self, model_id: str):
        """Internal unload: calls _unload_model_internal from main module."""
        try:
            from flow_llm.main import _unload_model_internal
            await _unload_model_internal(model_id)
        except ImportError:
            logger.error(f"Cannot import _unload_model_internal for '{model_id}'")
        except Exception:
            logger.exception(f"Error during cooldown unload of '{model_id}'")

    # -- Cleanup --------------------------------------------------------

    async def cleanup(self):
        """Cancel all pending cooldown tasks (called at shutdown)."""
        for info in self._access.values():
            if info.cooldown_task is not None:
                info.cooldown_task.cancel()
        # Release unloading locks
        for lock in self._unloading.values():
            if lock.locked():
                lock.release()
        self._access.clear()
        self._unloading.clear()


# Global singleton
jit_manager = JITManager()
