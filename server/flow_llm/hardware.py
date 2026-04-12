"""Hardware detection — Apple Silicon specs and memory info."""

import platform
import subprocess
from dataclasses import dataclass
from typing import Optional

import psutil


@dataclass
class HardwareInfo:
    """Detected hardware information."""

    chip: str  # e.g. "M4 Max"
    memory_total_gb: float
    memory_available_gb: float
    memory_used_gb: float
    cpu_count: int
    is_apple_silicon: bool
    metal_supported: bool

    @property
    def recommended_max_model_gb(self) -> float:
        """Maximum model size that fits in memory with headroom."""
        # Leave 8GB for system, 20% of total for KV cache and context
        headroom = max(8, self.memory_total_gb * 0.2)
        return round(self.memory_total_gb - headroom, 1)


def get_hardware_info() -> HardwareInfo:
    """Detect Apple Silicon hardware specs and memory info."""
    # Detect chip type
    chip = _detect_chip()

    # Memory info
    mem = psutil.virtual_memory()
    memory_total_gb = round(mem.total / (1024**3), 1)
    memory_available_gb = round(mem.available / (1024**3), 1)
    memory_used_gb = round(mem.used / (1024**3), 1)

    # Apple Silicon detection
    is_apple_silicon = platform.processor() == "arm" or "arm64" in platform.machine()

    # Metal is supported on all Apple Silicon
    metal_supported = is_apple_silicon

    return HardwareInfo(
        chip=chip,
        memory_total_gb=memory_total_gb,
        memory_available_gb=memory_available_gb,
        memory_used_gb=memory_used_gb,
        cpu_count=psutil.cpu_count(logical=False),
        is_apple_silicon=is_apple_silicon,
        metal_supported=metal_supported,
    )


def _detect_chip() -> str:
    """Detect the Apple Silicon chip type."""
    try:
        # On macOS, use system_profiler
        result = subprocess.run(
            ["system_profiler", "SPHardwareDataType"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        for line in result.stdout.splitlines():
            if "Chip" in line:
                return line.split(":")[-1].strip()
            if "Processor Name" in line:
                return line.split(":")[-1].strip()
    except Exception:
        pass

    # Fallback: check uname
    machine = platform.machine()
    if "arm" in machine.lower():
        return "Apple Silicon (unknown)"

    return f"Unknown ({machine})"


def estimate_model_memory(size_gb: float, ctx_size: int, quant_kv: str = "q4_0") -> float:
    """Estimate total memory needed for a model with given context.

    Args:
        size_gb: Model file size in GB
        ctx_size: Context window size in tokens
        quant_kv: KV cache quantization type

    Returns:
        Estimated total memory needed in GB
    """
    # Model weights take roughly the file size
    model_memory = size_gb

    # KV cache estimation (very rough)
    # For a 26B model with 2816 embedding dim and 64 layers:
    # Per token: 2 * n_layers * n_embd * bytes_per_element
    # This varies by model, so we use a rough heuristic
    # ~0.5MB per token for f16, ~0.125MB per token for q4_0
    bytes_per_token = {
        "f32": 0.0005,
        "f16": 0.00025,
        "bf16": 0.00025,
        "q8_0": 0.000125,
        "q4_0": 0.0000625,
        "q4_1": 0.0000625,
        "q5_0": 0.000078125,
        "q5_1": 0.000078125,
    }

    kv_per_token_gb = bytes_per_token.get(quant_kv, 0.00025)  # default to f16
    kv_total_gb = ctx_size * kv_per_token_gb * 2  # 2 for K and V

    # Scale by model size (heuristic: larger models have larger KV)
    scale_factor = max(1.0, size_gb / 10.0)  # 10GB is our baseline

    return round(model_memory + (kv_total_gb * scale_factor), 1)