"""Anthropic Messages API adapter helpers for Flow LLM."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any


class AnthropicRequestError(Exception):
    """Structured error for Anthropic-compatible request handling."""

    def __init__(self, status_code: int, error_type: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.error_type = error_type
        self.message = message


def make_request_id() -> str:
    """Create an Anthropic-style request id."""
    return f"req_{uuid.uuid4().hex[:24]}"


def make_message_id() -> str:
    """Create an Anthropic-style message id."""
    return f"msg_flow_{uuid.uuid4().hex[:24]}"


def error_body(error_type: str, message: str, request_id: str) -> dict[str, Any]:
    """Build an Anthropic-compatible error response body."""
    return {
        "type": "error",
        "error": {
            "type": error_type,
            "message": message,
        },
        "request_id": request_id,
    }


def invalid_request(message: str, status_code: int = 400) -> None:
    """Raise an Anthropic-compatible invalid request error."""
    raise AnthropicRequestError(status_code, "invalid_request_error", message)


def api_error(message: str, status_code: int = 500) -> None:
    """Raise an Anthropic-compatible API error."""
    raise AnthropicRequestError(status_code, "api_error", message)


def to_openai_chat_request(request: dict[str, Any]) -> dict[str, Any]:
    """Translate an Anthropic Messages request into OpenAI chat completions."""
    if not isinstance(request, dict):
        invalid_request("Request body must be a JSON object.")

    model = request.get("model")
    if not isinstance(model, str) or not model:
        invalid_request("`model` is required and must be a non-empty string.")

    max_tokens = request.get("max_tokens")
    if not isinstance(max_tokens, int) or max_tokens < 1:
        invalid_request("`max_tokens` is required and must be a positive integer.")

    messages = request.get("messages")
    if not isinstance(messages, list):
        invalid_request("`messages` is required and must be an array.")

    openai_messages: list[dict[str, Any]] = []

    system_message = _translate_system_prompt(request.get("system"))
    if system_message:
        openai_messages.append({"role": "system", "content": system_message})

    for idx, message in enumerate(messages):
        if not isinstance(message, dict):
            invalid_request(f"`messages[{idx}]` must be an object.")

        role = message.get("role")
        if role not in {"user", "assistant"}:
            invalid_request(f"`messages[{idx}].role` must be `user` or `assistant`.")

        blocks = _normalize_content_blocks(message.get("content", ""), f"messages[{idx}].content")
        openai_messages.extend(_blocks_to_openai_messages(role, blocks, idx))

    payload: dict[str, Any] = {
        "model": model,
        "messages": openai_messages,
        "max_tokens": max_tokens,
    }

    for key in ("stream", "temperature", "top_p"):
        if key in request:
            payload[key] = request[key]

    if "stop_sequences" in request:
        stop_sequences = request["stop_sequences"]
        if not isinstance(stop_sequences, list) or not all(isinstance(item, str) for item in stop_sequences):
            invalid_request("`stop_sequences` must be an array of strings.")
        payload["stop"] = stop_sequences

    if "tools" in request:
        payload["tools"] = _translate_tools(request["tools"])

    if "tool_choice" in request:
        payload["tool_choice"] = _translate_tool_choice(request["tool_choice"])

    return payload


def to_anthropic_response(openai_response: dict[str, Any], requested_model: str) -> dict[str, Any]:
    """Translate an OpenAI chat completion response into an Anthropic message."""
    choices = openai_response.get("choices")
    if not isinstance(choices, list) or not choices:
        api_error("Backend response did not contain any choices.")

    choice = choices[0]
    if not isinstance(choice, dict):
        api_error("Backend response choice was not an object.")

    message = choice.get("message")
    if not isinstance(message, dict):
        api_error("Backend response did not contain a message object.")

    content_blocks: list[dict[str, Any]] = []
    text_content = _normalize_openai_text(message.get("content"))
    if text_content:
        content_blocks.append({"type": "text", "text": text_content})

    tool_calls = message.get("tool_calls") or []
    if not isinstance(tool_calls, list):
        api_error("Backend response tool calls were malformed.")

    for tool_call in tool_calls:
        content_blocks.append(_translate_openai_tool_call(tool_call))

    usage = openai_response.get("usage") or {}
    finish_reason = choice.get("finish_reason")
    stop_reason = _map_stop_reason(finish_reason, bool(tool_calls))

    return {
        "id": openai_response.get("id") or make_message_id(),
        "type": "message",
        "role": "assistant",
        "model": openai_response.get("model") or requested_model,
        "content": content_blocks,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {
            "input_tokens": _coerce_usage_int(usage.get("prompt_tokens")),
            "output_tokens": _coerce_usage_int(usage.get("completion_tokens")),
        },
    }


@dataclass
class _ToolStreamState:
    content_index: int
    id: str
    name: str
    arguments: str = ""
    started: bool = False
    closed: bool = False


class AnthropicStreamTranslator:
    """Convert OpenAI chat completion stream chunks into Anthropic SSE events."""

    def __init__(self, model: str):
        self.model = model
        self.message_id = make_message_id()
        self.request_id = make_request_id()
        self.started = False
        self.finished = False
        self.current_block: tuple[str, int] | None = None
        self.next_content_index = 0
        self.text_block_index: int | None = None
        self.tool_states: dict[int, _ToolStreamState] = {}
        self.stop_reason: str | None = None
        self.input_tokens = 0
        self.output_tokens: int | None = None
        self.output_delta_count = 0

    def process_chunk(self, chunk: dict[str, Any]) -> tuple[list[str], bool]:
        """Translate a single OpenAI chunk."""
        events: list[str] = []
        emitted_output = False

        usage = chunk.get("usage")
        if isinstance(usage, dict):
            if usage.get("prompt_tokens") is not None:
                self.input_tokens = _coerce_usage_int(usage.get("prompt_tokens"))
            if usage.get("completion_tokens") is not None:
                self.output_tokens = _coerce_usage_int(usage.get("completion_tokens"))

        choices = chunk.get("choices")
        if not isinstance(choices, list) or not choices:
            return events, emitted_output

        choice = choices[0]
        if not isinstance(choice, dict):
            return events, emitted_output

        delta = choice.get("delta") or {}
        finish_reason = choice.get("finish_reason")
        if finish_reason is not None:
            tool_calls = delta.get("tool_calls") or []
            self.stop_reason = _map_stop_reason(finish_reason, bool(tool_calls))

        content_delta = delta.get("content")
        if isinstance(content_delta, str) and content_delta:
            events.extend(self._ensure_message_started())
            events.extend(self._ensure_text_block())
            events.append(
                _sse_event(
                    "content_block_delta",
                    {
                        "type": "content_block_delta",
                        "index": self.text_block_index,
                        "delta": {
                            "type": "text_delta",
                            "text": content_delta,
                        },
                    },
                )
            )
            emitted_output = True
            self.output_delta_count += 1

        tool_deltas = delta.get("tool_calls")
        if isinstance(tool_deltas, list):
            for tool_delta in tool_deltas:
                tool_events, tool_output = self._process_tool_delta(tool_delta)
                events.extend(tool_events)
                emitted_output = emitted_output or tool_output

        return events, emitted_output

    def finish_events(self) -> list[str]:
        """Emit the final Anthropic stream events."""
        if self.finished:
            return []

        events: list[str] = []
        events.extend(self._ensure_message_started())
        events.extend(self._close_current_block())

        try:
            self._validate_tool_inputs()
        except AnthropicRequestError as exc:
            self.finished = True
            return [
                _sse_event(
                    "error",
                    {
                        "type": "error",
                        "error": {
                            "type": exc.error_type,
                            "message": exc.message,
                        },
                    },
                )
            ]

        stop_reason = self.stop_reason or "end_turn"
        usage_output_tokens = self.output_tokens if self.output_tokens is not None else self.output_delta_count

        events.append(
            _sse_event(
                "message_delta",
                {
                    "type": "message_delta",
                    "delta": {
                        "stop_reason": stop_reason,
                        "stop_sequence": None,
                    },
                    "usage": {
                        "output_tokens": usage_output_tokens,
                    },
                },
            )
        )
        events.append(_sse_event("message_stop", {"type": "message_stop"}))
        self.finished = True
        return events

    def _ensure_message_started(self) -> list[str]:
        if self.started:
            return []
        self.started = True
        return [
            _sse_event(
                "message_start",
                {
                    "type": "message_start",
                    "message": {
                        "id": self.message_id,
                        "type": "message",
                        "role": "assistant",
                        "content": [],
                        "model": self.model,
                        "stop_reason": None,
                        "stop_sequence": None,
                        "usage": {
                            "input_tokens": self.input_tokens,
                            "output_tokens": 0,
                        },
                    },
                },
            )
        ]

    def _ensure_text_block(self) -> list[str]:
        if self.current_block == ("text", self.text_block_index):
            return []

        events = self._close_current_block()
        self.text_block_index = self.next_content_index
        self.next_content_index += 1
        self.current_block = ("text", self.text_block_index)
        events.append(
            _sse_event(
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": self.text_block_index,
                    "content_block": {
                        "type": "text",
                        "text": "",
                    },
                },
            )
        )
        return events

    def _process_tool_delta(self, tool_delta: Any) -> tuple[list[str], bool]:
        if not isinstance(tool_delta, dict):
            return [], False

        openai_index = tool_delta.get("index", 0)
        if not isinstance(openai_index, int):
            openai_index = 0

        function = tool_delta.get("function") or {}
        tool_id = tool_delta.get("id")
        if not isinstance(tool_id, str) or not tool_id:
            tool_id = f"toolu_flow_{uuid.uuid4().hex[:24]}"

        tool_name = function.get("name")
        if not isinstance(tool_name, str) or not tool_name:
            tool_name = "tool"

        state = self.tool_states.get(openai_index)
        if state is None:
            state = _ToolStreamState(
                content_index=self.next_content_index,
                id=tool_id,
                name=tool_name,
            )
            self.tool_states[openai_index] = state
            self.next_content_index += 1
        else:
            if tool_id:
                state.id = tool_id
            if tool_name:
                state.name = tool_name

        if state.closed:
            api_error("Backend emitted tool data after the tool block was closed.")

        events = self._ensure_message_started()
        if self.current_block != ("tool", openai_index):
            events.extend(self._close_current_block())
            if not state.started:
                events.append(
                    _sse_event(
                        "content_block_start",
                        {
                            "type": "content_block_start",
                            "index": state.content_index,
                            "content_block": {
                                "type": "tool_use",
                                "id": state.id,
                                "name": state.name,
                                "input": {},
                            },
                        },
                    )
                )
                state.started = True
            self.current_block = ("tool", openai_index)

        arguments_delta = function.get("arguments")
        emitted_output = False
        if isinstance(arguments_delta, str) and arguments_delta:
            events.append(
                _sse_event(
                    "content_block_delta",
                    {
                        "type": "content_block_delta",
                        "index": state.content_index,
                        "delta": {
                            "type": "input_json_delta",
                            "partial_json": arguments_delta,
                        },
                    },
                )
            )
            state.arguments += arguments_delta
            emitted_output = True
            self.output_delta_count += 1

        return events, emitted_output

    def _close_current_block(self) -> list[str]:
        if self.current_block is None:
            return []

        block_type, key = self.current_block
        self.current_block = None
        if block_type == "text":
            index = self.text_block_index
            self.text_block_index = None
            if index is None:
                return []
            return [_sse_event("content_block_stop", {"type": "content_block_stop", "index": index})]

        state = self.tool_states.get(key)
        if state is None or state.closed:
            return []
        state.closed = True
        return [_sse_event("content_block_stop", {"type": "content_block_stop", "index": state.content_index})]

    def _validate_tool_inputs(self) -> None:
        for state in self.tool_states.values():
            payload = state.arguments or "{}"
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError as exc:
                api_error(f"Backend emitted malformed tool-call JSON: {exc.msg}")
            if not isinstance(parsed, dict):
                api_error("Backend emitted tool-call input that was not a JSON object.")


def _translate_system_prompt(system: Any) -> str:
    if system is None:
        return ""
    if isinstance(system, str):
        return system
    if not isinstance(system, list):
        invalid_request("`system` must be a string or an array of text blocks.")

    parts: list[str] = []
    for idx, block in enumerate(system):
        if not isinstance(block, dict):
            invalid_request(f"`system[{idx}]` must be an object.")
        if block.get("type") != "text":
            invalid_request("Only text system blocks are supported in this Anthropic MVP.")
        if "citations" in block:
            invalid_request("Citations are not supported in this Anthropic MVP.")
        text = block.get("text")
        if not isinstance(text, str):
            invalid_request(f"`system[{idx}].text` must be a string.")
        parts.append(text)
    return "\n\n".join(parts)


def _normalize_content_blocks(content: Any, field_name: str) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if not isinstance(content, list):
        invalid_request(f"`{field_name}` must be a string or an array of content blocks.")

    blocks: list[dict[str, Any]] = []
    for idx, block in enumerate(content):
        if not isinstance(block, dict):
            invalid_request(f"`{field_name}[{idx}]` must be an object.")
        block_type = block.get("type")
        if not isinstance(block_type, str):
            invalid_request(f"`{field_name}[{idx}].type` is required.")
        if block_type in {"image", "document", "thinking", "redacted_thinking", "server_tool_use"}:
            invalid_request(f"Content block type `{block_type}` is not supported in this Anthropic MVP.")
        if "citations" in block:
            invalid_request("Citations are not supported in this Anthropic MVP.")
        if block_type not in {"text", "tool_use", "tool_result"}:
            invalid_request(f"Content block type `{block_type}` is not supported in this Anthropic MVP.")
        blocks.append(block)
    return blocks


def _blocks_to_openai_messages(role: str, blocks: list[dict[str, Any]], message_index: int) -> list[dict[str, Any]]:
    if role == "assistant":
        return _assistant_blocks_to_openai_messages(blocks, message_index)
    return _user_blocks_to_openai_messages(blocks, message_index)


def _assistant_blocks_to_openai_messages(blocks: list[dict[str, Any]], message_index: int) -> list[dict[str, Any]]:
    text_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []

    for block_index, block in enumerate(blocks):
        block_type = block["type"]
        if block_type == "text":
            text = block.get("text")
            if not isinstance(text, str):
                invalid_request(f"`messages[{message_index}].content[{block_index}].text` must be a string.")
            text_parts.append(text)
            continue

        if block_type != "tool_use":
            invalid_request("Assistant messages may only contain text and tool_use blocks.")

        tool_id = block.get("id")
        tool_name = block.get("name")
        tool_input = block.get("input", {})

        if not isinstance(tool_id, str) or not tool_id:
            invalid_request(f"`messages[{message_index}].content[{block_index}].id` must be a non-empty string.")
        if not isinstance(tool_name, str) or not tool_name:
            invalid_request(f"`messages[{message_index}].content[{block_index}].name` must be a non-empty string.")
        if not isinstance(tool_input, dict):
            invalid_request(f"`messages[{message_index}].content[{block_index}].input` must be an object.")

        tool_calls.append(
            {
                "id": tool_id,
                "type": "function",
                "function": {
                    "name": tool_name,
                    "arguments": json.dumps(tool_input, separators=(",", ":")),
                },
            }
        )

    if not text_parts and not tool_calls:
        return []

    message: dict[str, Any] = {"role": "assistant"}
    if text_parts:
        message["content"] = "\n".join(text_parts)
    else:
        message["content"] = ""
    if tool_calls:
        message["tool_calls"] = tool_calls
    return [message]


def _user_blocks_to_openai_messages(blocks: list[dict[str, Any]], message_index: int) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    text_parts: list[str] = []

    def flush_text_parts() -> None:
        if text_parts:
            messages.append({"role": "user", "content": "\n".join(text_parts)})
            text_parts.clear()

    for block_index, block in enumerate(blocks):
        block_type = block["type"]
        if block_type == "text":
            text = block.get("text")
            if not isinstance(text, str):
                invalid_request(f"`messages[{message_index}].content[{block_index}].text` must be a string.")
            text_parts.append(text)
            continue

        if block_type != "tool_result":
            invalid_request("User messages may only contain text and tool_result blocks.")

        flush_text_parts()
        tool_use_id = block.get("tool_use_id")
        if not isinstance(tool_use_id, str) or not tool_use_id:
            invalid_request(f"`messages[{message_index}].content[{block_index}].tool_use_id` must be a non-empty string.")
        content = _render_tool_result_content(block.get("content", ""), message_index, block_index)
        messages.append({"role": "tool", "tool_call_id": tool_use_id, "content": content})

    flush_text_parts()
    return messages


def _render_tool_result_content(content: Any, message_index: int, block_index: int) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        invalid_request(
            f"`messages[{message_index}].content[{block_index}].content` must be a string or an array of text blocks."
        )

    parts: list[str] = []
    for item_index, item in enumerate(content):
        if not isinstance(item, dict):
            invalid_request(
                f"`messages[{message_index}].content[{block_index}].content[{item_index}]` must be an object."
            )
        if item.get("type") != "text":
            invalid_request("Tool results only support text content in this Anthropic MVP.")
        if "citations" in item:
            invalid_request("Citations are not supported in this Anthropic MVP.")
        text = item.get("text")
        if not isinstance(text, str):
            invalid_request(
                f"`messages[{message_index}].content[{block_index}].content[{item_index}].text` must be a string."
            )
        parts.append(text)
    return "\n".join(parts)


def _translate_tools(tools: Any) -> list[dict[str, Any]]:
    if not isinstance(tools, list):
        invalid_request("`tools` must be an array.")

    translated: list[dict[str, Any]] = []
    for idx, tool in enumerate(tools):
        if not isinstance(tool, dict):
            invalid_request(f"`tools[{idx}]` must be an object.")
        tool_type = tool.get("type")
        if tool_type not in (None, "custom"):
            invalid_request(f"Tool type `{tool_type}` is not supported in this Anthropic MVP.")

        name = tool.get("name")
        if not isinstance(name, str) or not name:
            invalid_request(f"`tools[{idx}].name` must be a non-empty string.")

        description = tool.get("description", "")
        if description is not None and not isinstance(description, str):
            invalid_request(f"`tools[{idx}].description` must be a string.")

        input_schema = tool.get("input_schema", {"type": "object", "properties": {}})
        if not isinstance(input_schema, dict):
            invalid_request(f"`tools[{idx}].input_schema` must be an object.")

        translated.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description or "",
                    "parameters": input_schema,
                },
            }
        )
    return translated


def _translate_tool_choice(tool_choice: Any) -> Any:
    if isinstance(tool_choice, str):
        tool_choice = {"type": tool_choice}

    if not isinstance(tool_choice, dict):
        invalid_request("`tool_choice` must be an object.")

    choice_type = tool_choice.get("type")
    if choice_type == "auto":
        return "auto"
    if choice_type == "any":
        return "required"
    if choice_type == "none":
        return "none"
    if choice_type == "tool":
        name = tool_choice.get("name")
        if not isinstance(name, str) or not name:
            invalid_request("`tool_choice.name` must be a non-empty string when `type` is `tool`.")
        return {
            "type": "function",
            "function": {"name": name},
        }

    invalid_request(f"`tool_choice.type` value `{choice_type}` is not supported in this Anthropic MVP.")


def _translate_openai_tool_call(tool_call: Any) -> dict[str, Any]:
    if not isinstance(tool_call, dict):
        api_error("Backend response tool call was malformed.")

    function = tool_call.get("function")
    if not isinstance(function, dict):
        api_error("Backend response tool call did not include a function object.")

    name = function.get("name")
    if not isinstance(name, str) or not name:
        api_error("Backend response tool call did not include a valid function name.")

    arguments = function.get("arguments", "{}")
    if isinstance(arguments, str):
        try:
            parsed_arguments = json.loads(arguments)
        except json.JSONDecodeError as exc:
            api_error(f"Backend emitted malformed tool-call JSON: {exc.msg}")
    elif isinstance(arguments, dict):
        parsed_arguments = arguments
    else:
        api_error("Backend response tool-call arguments were malformed.")

    if not isinstance(parsed_arguments, dict):
        api_error("Backend response tool-call arguments must decode to a JSON object.")

    tool_id = tool_call.get("id")
    if not isinstance(tool_id, str) or not tool_id:
        tool_id = f"toolu_flow_{uuid.uuid4().hex[:24]}"

    return {
        "type": "tool_use",
        "id": tool_id,
        "name": name,
        "input": parsed_arguments,
    }


def _normalize_openai_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "\n".join(parts)
    api_error("Backend response content was malformed.")


def _map_stop_reason(finish_reason: Any, has_tool_calls: bool) -> str:
    if has_tool_calls or finish_reason in {"tool_calls", "function_call"}:
        return "tool_use"
    if finish_reason in {"length", "max_tokens"}:
        return "max_tokens"
    return "end_turn"


def _coerce_usage_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(value, 0)
    return 0


def _sse_event(event_name: str, payload: dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"
