"""Request tracker for per-request lifecycle monitoring.

Tracks every inference request as it passes through the proxy, from
arrival through prefill, generation, and completion. Broadcasts updates
via WebSocket for real-time Monitor page display.
"""

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ActiveRequest:
    """A single inference request being tracked."""
    request_id: str
    model_id: str
    route: str               # "/v1/chat/completions" or "/v1/messages"
    stage: str               # "queued" | "prefilling" | "generating" | "sending" | "completed" | "error"
    started_at: float         # time.monotonic()
    output_tokens: int = 0
    input_tokens: Optional[int] = None
    tokens_per_sec: Optional[float] = None
    ttft_ms: Optional[float] = None
    first_token_time: Optional[float] = None
    error_message: Optional[str] = None
    completed_at: Optional[float] = None


# Global state
_active_requests: dict[str, ActiveRequest] = {}
_model_requests: dict[str, list[str]] = {}

# Broadcast throttling: max one broadcast per model per 50ms
_last_broadcast: dict[str, float] = {}
_pending_broadcasts: dict[str, Optional[ActiveRequest]] = {}
_BROADCAST_INTERVAL = 0.05  # 50ms


def _req_to_dict(req: ActiveRequest) -> dict:
    """Convert ActiveRequest to a JSON-serializable dict."""
    return asdict(req)


def _schedule_broadcast(request: ActiveRequest):
    """Schedule a WebSocket broadcast, throttled per model."""
    now = time.monotonic()
    model_id = request.model_id

    # Buffer the latest state
    _pending_broadcasts[model_id] = request

    last = _last_broadcast.get(model_id, 0)
    if now - last >= _BROADCAST_INTERVAL:
        # Enough time has passed, flush immediately
        _flush_broadcast(model_id)
    # Otherwise, the pending broadcast will be flushed by the next
    # eligible call or by _flush_all_pending()


def _flush_broadcast(model_id: str):
    """Send the pending broadcast for a model if one exists."""
    if model_id not in _pending_broadcasts:
        return

    request = _pending_broadcasts.pop(model_id)
    if request is None:
        return

    _last_broadcast[model_id] = time.monotonic()

    # Import here to avoid circular imports at module level
    try:
        from flow_llm.main import broadcast
        # Schedule the broadcast as a task (we may be in a sync context)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(broadcast("request_update", _req_to_dict(request)))
        except RuntimeError:
            # No running loop — will be picked up by polling endpoint
            pass
    except ImportError:
        pass


def flush_all_pending():
    """Flush any throttled broadcasts. Called periodically."""
    for model_id in list(_pending_broadcasts.keys()):
        _flush_broadcast(model_id)


def create_request(model_id: str, route: str) -> str:
    """Create a new tracked request. Returns the request_id."""
    request_id = uuid.uuid4().hex[:12]
    req = ActiveRequest(
        request_id=request_id,
        model_id=model_id,
        route=route,
        stage="queued",
        started_at=time.monotonic(),
    )
    _active_requests[request_id] = req
    if model_id not in _model_requests:
        _model_requests[model_id] = []
    _model_requests[model_id].append(request_id)
    _schedule_broadcast(req)
    return request_id


def update_request(request_id: str, **kwargs):
    """Update fields on a tracked request and broadcast."""
    req = _active_requests.get(request_id)
    if req is None:
        return

    for key, value in kwargs.items():
        if hasattr(req, key):
            setattr(req, key, value)

    _schedule_broadcast(req)


def complete_request(request_id: str, **kwargs):
    """Mark a request as completed and schedule pruning."""
    req = _active_requests.get(request_id)
    if req is None:
        return

    req.stage = "completed"
    req.completed_at = time.monotonic()
    for key, value in kwargs.items():
        if hasattr(req, key):
            setattr(req, key, value)

    _schedule_broadcast(req)

    # Schedule pruning after 5 seconds
    async def _prune():
        await asyncio.sleep(5)
        prune_request(request_id)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_prune())
    except RuntimeError:
        pass


def error_request(request_id: str, error_message: str):
    """Mark a request as errored and schedule pruning."""
    req = _active_requests.get(request_id)
    if req is None:
        return

    req.stage = "error"
    req.error_message = error_message

    _schedule_broadcast(req)

    # Schedule pruning after 5 seconds
    async def _prune():
        await asyncio.sleep(5)
        prune_request(request_id)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_prune())
    except RuntimeError:
        pass


def prune_request(request_id: str):
    """Remove a request from tracking."""
    req = _active_requests.pop(request_id, None)
    if req and req.model_id in _model_requests:
        try:
            _model_requests[req.model_id].remove(request_id)
        except ValueError:
            pass

    # Broadcast removal
    try:
        from flow_llm.main import broadcast
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(broadcast("request_removed", {"request_id": request_id}))
        except RuntimeError:
            pass
    except ImportError:
        pass


def prune_completed():
    """Remove all completed/error entries older than 5 seconds."""
    now = time.monotonic()
    to_prune = []
    for rid, req in _active_requests.items():
        if req.completed_at and now - req.completed_at > 5:
            to_prune.append(rid)
        elif req.stage == "error" and req.completed_at and now - req.completed_at > 5:
            to_prune.append(rid)
    for rid in to_prune:
        prune_request(rid)


def clear_stuck(max_age_seconds: float = 120):
    """Remove requests stuck in queued/generating/prefilling/sending for too long."""
    now = time.monotonic()
    to_prune = []
    for rid, req in _active_requests.items():
        if req.stage in ("queued", "prefilling", "generating", "sending"):
            if now - req.started_at > max_age_seconds:
                to_prune.append(rid)
    for rid in to_prune:
        req = _active_requests.get(rid)
        if req:
            logger.info(f"Pruning stuck request {rid} (stage={req.stage}, age={now - req.started_at:.0f}s)")
        prune_request(rid)
    return len(to_prune)


def get_requests_for_model(model_id: str) -> list[dict]:
    """Return all active requests for a model as dicts."""
    prune_completed()
    flush_all_pending()
    request_ids = _model_requests.get(model_id, [])
    return [_req_to_dict(_active_requests[rid]) for rid in request_ids if rid in _active_requests]


def get_all_active() -> dict[str, list[dict]]:
    """Return all active requests grouped by model_id."""
    prune_completed()
    flush_all_pending()
    result: dict[str, list[dict]] = {}
    for model_id, request_ids in _model_requests.items():
        reqs = [_req_to_dict(_active_requests[rid]) for rid in request_ids if rid in _active_requests]
        if reqs:
            result[model_id] = reqs
    return result