"""Configuration for JAMES server."""

import os
from pathlib import Path
from typing import Optional

# Default paths
DEFAULT_DATA_DIR = Path(os.environ.get("JAMES_DATA_DIR", str(Path.home() / ".james")))
DEFAULT_MODELS_DIR = Path(os.environ.get("JAMES_MODELS_DIR", str(DEFAULT_DATA_DIR / "models")))
DEFAULT_DB_PATH = DEFAULT_DATA_DIR / "james.db"

# Server defaults
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 3377
DEFAULT_API_PREFIX = "/api"

# Backend defaults
DEFAULT_LLAMACPP_HOST = "127.0.0.1"
DEFAULT_LLAMACPP_PORT_RANGE = (8081, 8099)
DEFAULT_MLX_HOST = "127.0.0.1"
DEFAULT_MLX_PORT_RANGE = (8100, 8119)

# Hardware defaults
DEFAULT_CTX_SIZE = 100000
DEFAULT_FLASH_ATTN = "on"
DEFAULT_CACHE_TYPE_K = "q4_0"
DEFAULT_CACHE_TYPE_V = "q4_0"
DEFAULT_GPU_LAYERS = -1  # -1 = all layers
DEFAULT_N_PARALLEL = 2


class Settings:
    """Application settings, loaded from env vars and config file."""

    def __init__(self):
        self.data_dir = DEFAULT_DATA_DIR
        self.models_dir = DEFAULT_MODELS_DIR
        self.db_path = DEFAULT_DB_PATH
        self.host = DEFAULT_HOST
        self.port = DEFAULT_PORT
        self.llamacpp_port_range = DEFAULT_LLAMACPP_PORT_RANGE
        self.mlx_port_range = DEFAULT_MLX_PORT_RANGE

        # Model launch defaults
        self.default_ctx_size = DEFAULT_CTX_SIZE
        self.default_flash_attn = DEFAULT_FLASH_ATTN
        self.default_cache_type_k = DEFAULT_CACHE_TYPE_K
        self.default_cache_type_v = DEFAULT_CACHE_TYPE_V
        self.default_gpu_layers = DEFAULT_GPU_LAYERS
        self.default_n_parallel = DEFAULT_N_PARALLEL

    def ensure_dirs(self):
        """Create data and models directories if they don't exist."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()