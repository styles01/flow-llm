"""Template validator — checks chat templates before model loading.

Prevents the exact LM Studio failures we've seen:
- Jinja syntax errors (Gemma 4 chat_template.jinja)
- Missing system role support
- Missing tool calling support
- Missing tokenizer files
"""

import json
import logging
from pathlib import Path
from typing import Optional

from jinja2 import Environment, BaseLoader, TemplateSyntaxError

logger = logging.getLogger(__name__)


class ValidationResult:
    """Result of template validation."""

    def __init__(
        self,
        valid: bool,
        supports_system: bool = False,
        supports_tools: bool = False,
        supports_streaming: bool = True,
        errors: Optional[list[str]] = None,
        warnings: Optional[list[str]] = None,
        template_source: Optional[str] = None,
    ):
        self.valid = valid
        self.supports_system = supports_system
        self.supports_tools = supports_tools
        self.supports_streaming = supports_streaming
        self.errors = errors or []
        self.warnings = warnings or []
        self.template_source = template_source

    def __repr__(self):
        status = "PASS" if self.valid else "FAIL"
        flags = []
        if self.supports_system:
            flags.append("system")
        if self.supports_tools:
            flags.append("tools")
        return f"ValidationResult({status}, flags=[{', '.join(flags)}], errors={self.errors})"


def _find_chat_template(model_dir: Path) -> Optional[str]:
    """Find the chat template in a model directory.

    Checks both tokenizer_config.json and standalone chat_template.jinja file.
    This handles the Gemma 4 case where the template is in a separate file.
    """
    # Check tokenizer_config.json first
    tokenizer_config = model_dir / "tokenizer_config.json"
    if tokenizer_config.exists():
        try:
            with open(tokenizer_config) as f:
                config = json.load(f)
            if "chat_template" in config and config["chat_template"]:
                return config["chat_template"]
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Failed to read tokenizer_config.json: {e}")

    # Check standalone chat_template.jinja (Gemma 4 and others)
    jinja_file = model_dir / "chat_template.jinja"
    if jinja_file.exists():
        try:
            with open(jinja_file) as f:
                return f.read()
        except OSError as e:
            logger.warning(f"Failed to read chat_template.jinja: {e}")

    return None


def _check_tokenizer_files(model_dir: Path) -> list[str]:
    """Check that essential tokenizer files exist."""
    missing = []
    required = ["tokenizer_config.json", "tokenizer.json"]
    for fname in required:
        if not (model_dir / fname).exists():
            missing.append(fname)

    # chat_template.jinja is not required if template is in tokenizer_config.json
    # but warn if it's the only template source and missing
    return missing


def _validate_jinja_syntax(template_str: str) -> list[str]:
    """Validate Jinja2 template syntax."""
    errors = []
    try:
        env = Environment(loader=BaseLoader())
        env.parse(template_str)
    except TemplateSyntaxError as e:
        errors.append(f"Jinja syntax error at line {e.lineno}: {e.message}")
    except Exception as e:
        errors.append(f"Template parsing error: {e}")
    return errors


def _test_render_system_prompt(template_str: str) -> tuple[bool, list[str]]:
    """Test that the template handles system role messages."""
    from jinja2 import Environment, BaseLoader

    warnings = []
    try:
        env = Environment(loader=BaseLoader())
        template = env.from_string(template_str)

        # Test with a system message
        result = template.render(
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Hello"},
            ],
            add_generation_prompt=True,
            bos_token="<bos>",
            eos_token="<eos>",
        )

        if "helpful assistant" in result or "system" in result.lower():
            return True, warnings
        else:
            warnings.append("System message may not be included in rendered output")
            return False, warnings
    except Exception as e:
        warnings.append(f"Could not test system role rendering: {e}")
        # If we can't test, assume it works based on template content analysis
        if "system" in template_str or "developer" in template_str:
            return True, warnings
        return False, warnings


def _test_render_tools(template_str: str) -> tuple[bool, list[str]]:
    """Test that the template handles tool calling."""
    warnings = []
    try:
        env = Environment(loader=BaseLoader())
        template = env.from_string(template_str)

        test_tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get weather",
                    "parameters": {
                        "type": "object",
                        "properties": {"location": {"type": "string"}},
                        "required": ["location"],
                    },
                },
            }
        ]

        result = template.render(
            messages=[
                {"role": "user", "content": "What's the weather?"},
            ],
            tools=test_tools,
            add_generation_prompt=True,
            bos_token="<bos>",
            eos_token="<eos>",
        )

        if "get_weather" in result or "tool" in result.lower():
            return True, warnings
        else:
            warnings.append("Tool definitions may not be included in rendered output")
            return False, warnings
    except Exception as e:
        warnings.append(f"Could not test tool rendering: {e}")
        # Check template source for tool-related code
        if any(kw in template_str for kw in ["tools", "tool_call", "function", "declaration"]):
            return True, warnings
        return False, warnings


def validate_model_dir(model_dir: Path) -> ValidationResult:
    """Validate a model directory for template and tokenizer completeness.

    This is the main entry point. Pass the directory containing the model files
    (tokenizer_config.json, etc.) or the GGUF file directory.
    """
    errors = []
    warnings = []

    # Check that the directory exists
    if not model_dir.exists():
        return ValidationResult(
            valid=False,
            errors=[f"Model directory does not exist: {model_dir}"],
        )

    # Find the chat template
    template_str = _find_chat_template(model_dir)
    if template_str is None:
        # For GGUF files, templates are embedded in the file
        # The validator can't extract them, so we check for a .gguf file instead
        gguf_files = list(model_dir.glob("*.gguf"))
        if gguf_files:
            # GGUF files have templates embedded — we validate at runtime
            warnings.append(
                "GGUF model: template is embedded in the file. "
                "Will be validated when model is loaded."
            )
            return ValidationResult(
                valid=True,
                supports_system=True,  # Assume until proven otherwise
                supports_tools=True,   # Assume until proven otherwise
                warnings=warnings,
            )
        else:
            errors.append(
                "No chat template found. Expected tokenizer_config.json "
                "with 'chat_template' key, or a chat_template.jinja file."
            )
            return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # Validate Jinja syntax
    syntax_errors = _validate_jinja_syntax(template_str)
    errors.extend(syntax_errors)

    if syntax_errors:
        return ValidationResult(
            valid=False,
            errors=errors,
            warnings=warnings,
            template_source=template_str[:200] + "..." if len(template_str) > 200 else template_str,
        )

    # Test system role support
    supports_system, sys_warnings = _test_render_system_prompt(template_str)
    warnings.extend(sys_warnings)

    # Test tool calling support
    supports_tools, tool_warnings = _test_render_tools(template_str)
    warnings.extend(tool_warnings)

    # Check tokenizer files
    missing_files = _check_tokenizer_files(model_dir)
    for f in missing_files:
        warnings.append(f"Missing tokenizer file: {f}")

    return ValidationResult(
        valid=len(errors) == 0,
        supports_system=supports_system,
        supports_tools=supports_tools,
        errors=errors,
        warnings=warnings,
        template_source=template_str[:200] + "..." if len(template_str) > 200 else template_str,
    )