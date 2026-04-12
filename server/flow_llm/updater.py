"""Backend updater — checks for and applies updates to llama.cpp and mlx-openai-server."""

import asyncio
import json
import logging
import shutil
import subprocess
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ComponentVersion:
    name: str
    current: Optional[str] = None       # installed version string
    latest: Optional[str] = None        # latest available version string
    update_available: bool = False
    install_method: str = "unknown"     # "brew", "pip", "not_found"
    updating: bool = False
    update_log: list[str] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "current": self.current,
            "latest": self.latest,
            "update_available": self.update_available,
            "install_method": self.install_method,
            "updating": self.updating,
            "update_log": self.update_log[-50:],  # cap at 50 lines for API response
            "error": self.error,
        }


# Module-level version state — persists across API calls
_versions: dict[str, ComponentVersion] = {
    "llamacpp": ComponentVersion(name="llama.cpp"),
    "mlx": ComponentVersion(name="mlx-openai-server"),
}


def get_versions() -> dict[str, ComponentVersion]:
    return _versions


# --- llama.cpp ---


def _detect_llamacpp_install_method() -> str:
    """Detect whether llama-server was installed via brew or another method."""
    if shutil.which("brew"):
        try:
            result = subprocess.run(
                ["brew", "list", "--formula"],
                capture_output=True, text=True, timeout=10
            )
            if "llama.cpp" in result.stdout:
                return "brew"
        except Exception:
            pass
    if shutil.which("llama-server"):
        return "other"
    return "not_found"


def _get_llamacpp_installed_version(install_method: str) -> Optional[str]:
    """Get the currently installed llama.cpp version."""
    if install_method == "brew":
        try:
            result = subprocess.run(
                ["brew", "info", "--json=v2", "llama.cpp"],
                capture_output=True, text=True, timeout=15
            )
            data = json.loads(result.stdout)
            formulae = data.get("formulae", [])
            if formulae:
                installed = formulae[0].get("installed", [])
                if installed:
                    return installed[0].get("version")
        except Exception:
            pass

    # Fall back to --version flag
    if shutil.which("llama-server"):
        try:
            result = subprocess.run(
                ["llama-server", "--version"],
                capture_output=True, text=True, timeout=10
            )
            output = result.stdout + result.stderr
            # Parse "version: 3456" or "version: b3456" or "ggml_metal_init"
            import re
            m = re.search(r'version[:\s]+b?(\d+)', output, re.IGNORECASE)
            if m:
                return f"b{m.group(1)}"
        except Exception:
            pass
    return None


def _get_llamacpp_latest_brew() -> Optional[str]:
    """Get the latest llama.cpp version available in Homebrew."""
    try:
        result = subprocess.run(
            ["brew", "info", "--json=v2", "llama.cpp"],
            capture_output=True, text=True, timeout=15
        )
        data = json.loads(result.stdout)
        formulae = data.get("formulae", [])
        if formulae:
            versions = formulae[0].get("versions", {})
            return versions.get("stable")
    except Exception:
        pass
    return None


def _get_llamacpp_latest_github() -> Optional[str]:
    """Get the latest llama.cpp release tag from GitHub."""
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest",
            headers={"User-Agent": "flow-llm-updater/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("tag_name")  # e.g. "b3456"
    except Exception:
        pass
    return None


async def check_llamacpp() -> ComponentVersion:
    """Check current and latest llama.cpp versions."""
    v = _versions["llamacpp"]
    v.error = None

    loop = asyncio.get_event_loop()
    install_method = await loop.run_in_executor(None, _detect_llamacpp_install_method)
    v.install_method = install_method

    if install_method == "not_found":
        v.current = None
        v.latest = None
        v.update_available = False
        v.error = "llama-server not found on PATH"
        return v

    current = await loop.run_in_executor(None, _get_llamacpp_installed_version, install_method)
    v.current = current

    # Get latest version
    if install_method == "brew":
        latest = await loop.run_in_executor(None, _get_llamacpp_latest_brew)
    else:
        latest = await loop.run_in_executor(None, _get_llamacpp_latest_github)
    v.latest = latest

    # Compare: strip leading "b" and compare as integers
    if current and latest:
        try:
            def build_num(s: str) -> int:
                import re
                m = re.search(r'(\d+)', s)
                return int(m.group(1)) if m else 0
            v.update_available = build_num(latest) > build_num(current)
        except Exception:
            v.update_available = False
    else:
        v.update_available = False

    return v


async def update_llamacpp() -> bool:
    """Update llama.cpp. Returns True on success."""
    v = _versions["llamacpp"]
    if v.install_method != "brew":
        v.update_log.append("Auto-update only supported for Homebrew installs. Run: brew upgrade llama.cpp")
        return False

    v.updating = True
    v.update_log.append("Running: brew upgrade llama.cpp")
    try:
        proc = await asyncio.create_subprocess_exec(
            "brew", "upgrade", "llama.cpp",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await proc.communicate()
        lines = stdout.decode(errors="replace").splitlines()
        v.update_log.extend(lines)

        if proc.returncode == 0:
            v.update_log.append("llama.cpp updated successfully.")
            # Refresh version info
            await check_llamacpp()
            return True
        else:
            v.update_log.append(f"brew upgrade failed (exit {proc.returncode})")
            return False
    except Exception as e:
        v.update_log.append(f"Error during update: {e}")
        return False
    finally:
        v.updating = False


# --- mlx-openai-server ---


def _get_mlx_installed_version() -> Optional[str]:
    """Get the currently installed mlx-openai-server version via pip."""
    try:
        result = subprocess.run(
            ["pip", "show", "mlx-openai-server"],
            capture_output=True, text=True, timeout=15
        )
        for line in result.stdout.splitlines():
            if line.startswith("Version:"):
                return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return None


def _get_mlx_latest_pypi() -> Optional[str]:
    """Get the latest mlx-openai-server version from PyPI."""
    try:
        req = urllib.request.Request(
            "https://pypi.org/pypi/mlx-openai-server/json",
            headers={"User-Agent": "flow-llm-updater/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("info", {}).get("version")
    except Exception:
        pass
    return None


async def check_mlx() -> ComponentVersion:
    """Check current and latest mlx-openai-server versions."""
    v = _versions["mlx"]
    v.error = None

    if not shutil.which("mlx-openai-server") and not shutil.which("mlx_openai_server"):
        v.install_method = "not_found"
        v.current = None
        # Still check PyPI for latest even if not installed
        loop = asyncio.get_event_loop()
        v.latest = await loop.run_in_executor(None, _get_mlx_latest_pypi)
        v.update_available = False
        v.error = "mlx-openai-server not found (optional — only needed for MLX models)"
        return v

    v.install_method = "pip"
    loop = asyncio.get_event_loop()

    current = await loop.run_in_executor(None, _get_mlx_installed_version)
    v.current = current

    latest = await loop.run_in_executor(None, _get_mlx_latest_pypi)
    v.latest = latest

    if current and latest:
        try:
            from packaging.version import Version
            v.update_available = Version(latest) > Version(current)
        except Exception:
            # Fallback: simple string comparison
            v.update_available = current != latest
    else:
        v.update_available = False

    return v


async def update_mlx() -> bool:
    """Update mlx-openai-server via pip. Returns True on success."""
    v = _versions["mlx"]
    v.updating = True
    v.update_log.append("Running: pip install --upgrade mlx-openai-server")
    try:
        proc = await asyncio.create_subprocess_exec(
            "pip", "install", "--upgrade", "mlx-openai-server",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await proc.communicate()
        lines = stdout.decode(errors="replace").splitlines()
        v.update_log.extend(lines)

        if proc.returncode == 0:
            v.update_log.append("mlx-openai-server updated successfully.")
            await check_mlx()
            return True
        else:
            v.update_log.append(f"pip install failed (exit {proc.returncode})")
            return False
    except Exception as e:
        v.update_log.append(f"Error during update: {e}")
        return False
    finally:
        v.updating = False


# --- Main entrypoint ---


async def check_and_autoupdate(auto_update: bool = True):
    """Run version checks and optionally auto-update outdated backends.
    Called at startup. Safe to run concurrently."""
    print("[Flow] Checking backend versions...")

    try:
        await asyncio.gather(check_llamacpp(), check_mlx())
    except Exception as e:
        logger.warning(f"Version check failed: {e}")
        return

    llamacpp = _versions["llamacpp"]
    mlx = _versions["mlx"]

    print(f"[Flow] llama.cpp: {llamacpp.current or 'unknown'} → latest {llamacpp.latest or 'unknown'} (update: {llamacpp.update_available})")
    print(f"[Flow] mlx-openai-server: {mlx.current or 'not installed'} → latest {mlx.latest or 'unknown'} (update: {mlx.update_available})")

    if not auto_update:
        print("[Flow] Auto-update disabled — skipping updates")
        return

    tasks = []
    if llamacpp.update_available:
        print(f"[Flow] Updating llama.cpp {llamacpp.current} → {llamacpp.latest}...")
        tasks.append(update_llamacpp())
    if mlx.update_available and mlx.install_method == "pip":
        print(f"[Flow] Updating mlx-openai-server {mlx.current} → {mlx.latest}...")
        tasks.append(update_mlx())

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    else:
        print("[Flow] All backends up to date.")
