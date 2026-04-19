"""Configuration for Flow LLM."""

import json
import os
from pathlib import Path

# Default paths
DEFAULT_DATA_DIR = Path(os.environ.get("FLOW_DATA_DIR", str(Path.home() / ".flow")))
DEFAULT_DB_PATH = DEFAULT_DATA_DIR / "flow.db"
LEGACY_DATA_DIR = Path.home() / ".james"
LEGACY_DB_PATH = LEGACY_DATA_DIR / "james.db"

_models_dir_env = os.environ.get("FLOW_MODELS_DIR")
if _models_dir_env:
    DEFAULT_MODELS_DIR = Path(_models_dir_env)
else:
    DEFAULT_MODELS_DIR = DEFAULT_DATA_DIR / "models"
    volumes_root = Path("/Volumes")
    if volumes_root.exists():
        candidates = sorted(path for path in volumes_root.glob("*/llms") if path.is_dir())
        if candidates:
            DEFAULT_MODELS_DIR = candidates[0]

# Server defaults
DEFAULT_HOST = "0.0.0.0"
_flow_port_env = os.environ.get("FLOW_PORT")
DEFAULT_PORT = int(_flow_port_env) if _flow_port_env else 3377
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

        # Update preferences
        self.auto_update_backends: bool = True

    def ensure_dirs(self):
        """Create data and models directories if they don't exist."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)

    def _settings_file(self) -> Path:
        return self.data_dir / "settings.json"

    def load_from_disk(self):
        """Load persisted settings from JSON file (called at startup)."""
        sf = self._settings_file()
        if not sf.exists():
            return
        try:
            data = json.loads(sf.read_text())
            persistable = [
                "models_dir", "port",
                "default_ctx_size", "default_flash_attn", "default_cache_type_k",
                "default_cache_type_v", "default_gpu_layers", "default_n_parallel",
                "auto_update_backends",
            ]
            for key in persistable:
                if key in data:
                    if key == "models_dir":
                        self.models_dir = Path(data[key]).expanduser()
                    else:
                        setattr(self, key, data[key])
        except Exception:
            pass  # Corrupt or missing settings file — use defaults

    def save_to_disk(self):
        """Persist current settings to JSON file."""
        sf = self._settings_file()
        sf.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "models_dir": str(self.models_dir),
            "port": self.port,
            "default_ctx_size": self.default_ctx_size,
            "default_flash_attn": self.default_flash_attn,
            "default_cache_type_k": self.default_cache_type_k,
            "default_cache_type_v": self.default_cache_type_v,
            "default_gpu_layers": self.default_gpu_layers,
            "default_n_parallel": self.default_n_parallel,
            "auto_update_backends": self.auto_update_backends,
        }
        sf.write_text(json.dumps(data, indent=2))

    def _presets_file(self) -> Path:
        return self.data_dir / "presets.json"

    def load_presets(self) -> dict:
        pf = self._presets_file()
        if not pf.exists():
            return {"user_presets": []}
        try:
            return json.loads(pf.read_text())
        except Exception:
            return {"user_presets": []}

    def save_presets(self, data: dict):
        pf = self._presets_file()
        pf.parent.mkdir(parents=True, exist_ok=True)
        pf.write_text(json.dumps(data, indent=2))


settings = Settings()
