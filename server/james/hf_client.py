"""HuggingFace Hub client — search and download models with progress tracking."""

import logging
import os
from pathlib import Path
from typing import Optional

from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.constants import HF_HUB_CACHE

logger = logging.getLogger(__name__)

# Known GGUF quant suffixes and their approximate quality/memory tradeoffs
QUANT_RANKINGS = [
    "Q8_0",
    "Q6_K",
    "Q5_K_M",
    "Q5_K_S",
    "Q5_0",
    "Q4_K_M",
    "Q4_K_S",
    "Q4_0",
    "Q3_K_M",
    "Q3_K_S",
    "IQ4_NL",
    "IQ3_M",
    "IQ2_M",
]

# Active downloads for progress tracking
_active_downloads: dict[str, dict] = {}


class HuggingFaceClient:
    """Client for searching and downloading models from HuggingFace Hub."""

    def __init__(self, token: Optional[str] = None):
        self.api = HfApi(token=token)
        self.token = token

    def search_models(self, query: str, limit: int = 20) -> list[dict]:
        """Search for models on HuggingFace Hub."""
        results = []
        try:
            models = list(self.api.list_models(search=query, limit=limit, sort="downloads"))
            for m in models:
                results.append({
                    "id": m.id,
                    "author": m.author,
                    "downloads": m.downloads,
                    "tags": list(m.tags) if m.tags else [],
                    "pipeline_tag": m.pipeline_tag,
                    "created_at": str(m.created_at) if m.created_at else None,
                    "last_modified": str(m.last_modified) if m.last_modified else None,
                })
        except Exception as e:
            logger.error(f"Search failed: {e}")
        return results

    def get_model_details(self, model_id: str) -> Optional[dict]:
        """Get details about a specific model."""
        try:
            model_info = self.api.model_info(model_id)
            siblings = []
            if model_info.siblings:
                siblings = [s.rfilename for s in model_info.siblings]

            return {
                "id": model_info.id,
                "author": model_info.author,
                "downloads": model_info.downloads,
                "tags": list(model_info.tags) if model_info.tags else [],
                "pipeline_tag": model_info.pipeline_tag,
                "library_name": getattr(model_info, "library_name", None),
                "siblings": siblings,
                "has_gguf": any(f.endswith(".gguf") for f in siblings),
                "has_mlx": any("mlx" in f.lower() for f in siblings),
                "has_chat_template": any(
                    f in siblings
                    for f in ["tokenizer_config.json", "chat_template.jinja"]
                ),
            }
        except Exception as e:
            logger.error(f"Failed to get model details for {model_id}: {e}")
            return None

    def list_gguf_files(self, model_id: str) -> list[dict]:
        """List GGUF files available for a model, with size and quant info."""
        try:
            model_info = self.api.model_info(model_id)
            if not model_info.siblings:
                return []

            gguf_files = []
            for s in model_info.siblings:
                if s.rfilename.endswith(".gguf"):
                    quant = self._extract_quant(s.rfilename)
                    gguf_files.append({
                        "filename": s.rfilename,
                        "quantization": quant,
                        "size_bytes": s.size,
                        "size_gb": round(s.size / (1024**3), 2) if s.size else None,
                    })

            gguf_files.sort(key=lambda f: self._quant_rank(f.get("quantization", "")))
            return gguf_files
        except Exception as e:
            logger.error(f"Failed to list GGUF files for {model_id}: {e}")
            return []

    def list_mlx_files(self, model_id: str) -> list[dict]:
        """Check if MLX versions exist (usually in mlx-community org)."""
        base_name = model_id.split("/")[-1] if "/" in model_id else model_id
        mlx_id = f"mlx-community/{base_name}"

        try:
            model_info = self.api.model_info(mlx_id)
            if model_info.siblings:
                return [{"mlx_id": mlx_id, "available": True}]
        except Exception:
            pass

        return []

    def download_model(
        self,
        model_id: str,
        filename: Optional[str] = None,
        local_dir: Optional[str] = None,
    ) -> Path:
        """Download a model file from HuggingFace Hub.

        For GGUF: downloads the specific .gguf file
        For MLX: downloads the entire model directory

        Returns the path to the downloaded file/directory.
        """
        download_key = f"{model_id}/{filename}" if filename else model_id

        # Track progress
        _active_downloads[download_key] = {
            "status": "downloading",
            "model_id": model_id,
            "filename": filename,
            "progress": 0.0,
        }

        if local_dir is None:
            from james.config import settings
            local_dir = str(settings.models_dir)

        # Ensure the download directory exists with the model name as subfolder
        model_name = model_id.replace("/", "__")
        download_dir = Path(local_dir) / model_name
        download_dir.mkdir(parents=True, exist_ok=True)

        try:
            if filename:
                # Download a specific file (GGUF)
                # huggingface_hub supports resume downloads
                downloaded_path = hf_hub_download(
                    repo_id=model_id,
                    filename=filename,
                    local_dir=str(download_dir),
                    token=self.token,
                )
                _active_downloads[download_key]["progress"] = 100.0
                _active_downloads[download_key]["status"] = "complete"
            else:
                # Download the entire repo (MLX)
                from huggingface_hub import snapshot_download
                downloaded_path = snapshot_download(
                    repo_id=model_id,
                    local_dir=str(download_dir),
                    token=self.token,
                )
                _active_downloads[download_key]["progress"] = 100.0
                _active_downloads[download_key]["status"] = "complete"

            return Path(downloaded_path)
        except Exception as e:
            _active_downloads[download_key]["status"] = "error"
            _active_downloads[download_key]["error"] = str(e)
            logger.error(f"Download failed for {model_id}/{filename}: {e}")
            raise

    @staticmethod
    def get_download_progress(download_key: str) -> Optional[dict]:
        """Get the progress of an active download."""
        return _active_downloads.get(download_key)

    @staticmethod
    def get_all_downloads() -> dict[str, dict]:
        """Get all active downloads."""
        return dict(_active_downloads)

    @staticmethod
    def clear_completed_downloads():
        """Remove completed/error downloads from tracking."""
        to_remove = [k for k, v in _active_downloads.items() if v["status"] in ("complete", "error")]
        for k in to_remove:
            del _active_downloads[k]

    @staticmethod
    def _extract_quant(filename: str) -> str:
        """Extract quantization type from a GGUF filename."""
        import re
        match = re.search(
            r"(Q\d+_[A-Z]\d?_[A-Z]\d?|Q\d+_\d+|IQ\d+_[A-Z]\d?|F\d+|BF\d+|F16)",
            filename,
            re.IGNORECASE,
        )
        if match:
            return match.group(1).upper()
        return "unknown"

    @staticmethod
    def _quant_rank(quant: str) -> int:
        """Rank quantizations by quality (lower = better)."""
        quant_upper = quant.upper()
        for i, q in enumerate(QUANT_RANKINGS):
            if q in quant_upper:
                return i
        return len(QUANT_RANKINGS)