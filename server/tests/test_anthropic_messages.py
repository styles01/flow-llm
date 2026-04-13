import json
from collections import deque
from types import SimpleNamespace

from fastapi.testclient import TestClient

from flow_llm import main


class FakeResponse:
    def __init__(self, status_code=200, json_body=None, text_body=None, lines=None):
        self.status_code = status_code
        self._json_body = json_body
        if text_body is None and json_body is not None:
            text_body = json.dumps(json_body)
        self._text_body = text_body or ""
        self._lines = lines or []

    def json(self):
        if self._json_body is None:
            raise ValueError("No JSON body configured")
        return self._json_body

    @property
    def text(self):
        return self._text_body

    async def aread(self):
        return self._text_body.encode()

    async def aclose(self):
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class FakeAsyncClient:
    def __init__(self, *, post_response=None, send_response=None):
        self.post_response = post_response or FakeResponse()
        self.send_response = send_response or FakeResponse()
        self.post_calls = []
        self.send_calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def aclose(self):
        return None

    async def post(self, url, json=None, headers=None):
        self.post_calls.append({"url": url, "json": json, "headers": headers})
        return self.post_response

    def build_request(self, method, url, json=None, headers=None):
        return SimpleNamespace(method=method, url=url, json=json, headers=headers)

    async def send(self, request, stream=False):
        self.send_calls.append(
            {
                "method": request.method,
                "url": request.url,
                "json": request.json,
                "headers": request.headers,
                "stream": stream,
            }
        )
        return self.send_response


class FakeAsyncClientFactory:
    def __init__(self, *clients):
        self._clients = deque(clients)
        self.created = []

    def __call__(self, *args, **kwargs):
        client = self._clients.popleft()
        self.created.append(client)
        return client


def _install_loaded_model(monkeypatch, model_id="flow-model"):
    proc = SimpleNamespace(base_url="http://backend.test", backend="mlx", port=8100)
    monkeypatch.setattr(main.process_manager, "get_process", lambda requested: proc if requested == model_id else None)
    monkeypatch.setattr(main.process_manager, "get_all_processes", lambda: {model_id: proc})
    return proc


def _base_request(**overrides):
    request = {
        "model": "flow-model",
        "max_tokens": 64,
        "messages": [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}],
    }
    request.update(overrides)
    return request


def test_invalid_model_probe_returns_anthropic_error_json(monkeypatch):
    monkeypatch.setattr(main.process_manager, "get_process", lambda requested: None)
    monkeypatch.setattr(main.process_manager, "get_all_processes", lambda: {})
    monkeypatch.setattr("flow_llm.process_manager.reset_processing_progress", lambda model_id: None)

    async def fake_record_telemetry(**kwargs):
        return None

    monkeypatch.setattr(main, "_record_telemetry", fake_record_telemetry)

    client = TestClient(main.app)
    response = client.post(
        "/v1/messages",
        headers={
            "anthropic-version": "2023-06-01",
            "x-api-key": "flow",
            "Authorization": "Bearer flow",
        },
        json={
            "model": "__airun_flow_probe_invalid_model__",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": [{"type": "text", "text": "ping"}]}],
        },
    )

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["type"] == "error"
    assert body["error"]["type"] == "invalid_request_error"


def test_non_streaming_translation_and_response_mapping(monkeypatch):
    _install_loaded_model(monkeypatch)
    monkeypatch.setattr("flow_llm.process_manager.reset_processing_progress", lambda model_id: None)

    telemetry_calls = []

    async def fake_record_telemetry(**kwargs):
        telemetry_calls.append(kwargs)

    monkeypatch.setattr(main, "_record_telemetry", fake_record_telemetry)

    backend_response = FakeResponse(
        json_body={
            "id": "chatcmpl-1",
            "model": "flow-model",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "Working on it",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "shell",
                                    "arguments": "{\"cmd\":\"pwd\"}",
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 7,
                "total_tokens": 18,
            },
        }
    )
    factory = FakeAsyncClientFactory(FakeAsyncClient(post_response=backend_response))
    monkeypatch.setattr(main.httpx, "AsyncClient", factory)

    client = TestClient(main.app)
    response = client.post(
        "/v1/messages",
        json=_base_request(
            system="You are Flow",
            temperature=0.2,
            top_p=0.95,
            stop_sequences=["STOP"],
            tools=[
                {
                    "name": "shell",
                    "description": "Run a shell command",
                    "input_schema": {
                        "type": "object",
                        "properties": {"cmd": {"type": "string"}},
                        "required": ["cmd"],
                    },
                }
            ],
            tool_choice={"type": "any"},
        ),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "assistant"
    assert body["stop_reason"] == "tool_use"
    assert body["usage"] == {"input_tokens": 11, "output_tokens": 7}
    assert body["content"] == [
        {"type": "text", "text": "Working on it"},
        {"type": "tool_use", "id": "call_1", "name": "shell", "input": {"cmd": "pwd"}},
    ]

    captured = factory.created[0].post_calls[0]["json"]
    assert captured["model"] == "flow-model"
    assert captured["max_tokens"] == 64
    assert captured["stop"] == ["STOP"]
    assert captured["tool_choice"] == "required"
    assert captured["messages"][0] == {"role": "system", "content": "You are Flow"}
    assert captured["messages"][1] == {"role": "user", "content": "Hello"}
    assert captured["tools"] == [
        {
            "type": "function",
            "function": {
                "name": "shell",
                "description": "Run a shell command",
                "parameters": {
                    "type": "object",
                    "properties": {"cmd": {"type": "string"}},
                    "required": ["cmd"],
                },
            },
        }
    ]
    assert telemetry_calls


def test_streaming_messages_emit_anthropic_event_order(monkeypatch):
    _install_loaded_model(monkeypatch)
    monkeypatch.setattr("flow_llm.process_manager.reset_processing_progress", lambda model_id: None)

    async def fake_record_telemetry(**kwargs):
        return None

    monkeypatch.setattr(main, "_record_telemetry", fake_record_telemetry)

    stream_lines = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"},"finish_reason":null}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        "data: [DONE]",
    ]
    factory = FakeAsyncClientFactory(
        FakeAsyncClient(send_response=FakeResponse(status_code=200, lines=stream_lines))
    )
    monkeypatch.setattr(main.httpx, "AsyncClient", factory)

    client = TestClient(main.app)
    with client.stream("POST", "/v1/messages", json=_base_request(stream=True)) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert body.index("event: message_start") < body.index("event: content_block_start")
    assert body.index("event: content_block_start") < body.index("event: content_block_delta")
    assert body.index("event: content_block_delta") < body.index("event: content_block_stop")
    assert body.index("event: content_block_stop") < body.index("event: message_delta")
    assert body.index("event: message_delta") < body.index("event: message_stop")
    assert '"text":"Hello"' in body
    assert '"text":" world"' in body


def test_tool_result_followup_becomes_openai_tool_message(monkeypatch):
    _install_loaded_model(monkeypatch)
    monkeypatch.setattr("flow_llm.process_manager.reset_processing_progress", lambda model_id: None)

    async def fake_record_telemetry(**kwargs):
        return None

    monkeypatch.setattr(main, "_record_telemetry", fake_record_telemetry)

    backend_response = FakeResponse(
        json_body={
            "id": "chatcmpl-2",
            "model": "flow-model",
            "choices": [{"message": {"role": "assistant", "content": "Done"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12},
        }
    )
    factory = FakeAsyncClientFactory(FakeAsyncClient(post_response=backend_response))
    monkeypatch.setattr(main.httpx, "AsyncClient", factory)

    client = TestClient(main.app)
    response = client.post(
        "/v1/messages",
        json=_base_request(
            messages=[
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "call_1",
                            "name": "shell",
                            "input": {"cmd": "pwd"},
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "call_1", "content": "/home/user/project"},
                        {"type": "text", "text": "Summarize it"},
                    ],
                },
            ]
        ),
    )

    assert response.status_code == 200
    captured_messages = factory.created[0].post_calls[0]["json"]["messages"]
    assert captured_messages == [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "shell", "arguments": "{\"cmd\":\"pwd\"}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": "/home/user/project"},
        {"role": "user", "content": "Summarize it"},
    ]


def test_unsupported_block_returns_invalid_request_error(monkeypatch):
    monkeypatch.setattr(main.process_manager, "get_process", lambda requested: None)
    monkeypatch.setattr(main.process_manager, "get_all_processes", lambda: {})
    monkeypatch.setattr("flow_llm.process_manager.reset_processing_progress", lambda model_id: None)

    async def fake_record_telemetry(**kwargs):
        return None

    monkeypatch.setattr(main, "_record_telemetry", fake_record_telemetry)

    client = TestClient(main.app)
    response = client.post(
        "/v1/messages",
        json={
            "model": "flow-model",
            "max_tokens": 8,
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}}],
                }
            ],
        },
    )

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["type"] == "invalid_request_error"
    assert "not supported" in body["error"]["message"]


def test_auth_headers_are_accepted_without_enforcement(monkeypatch):
    _install_loaded_model(monkeypatch)
    monkeypatch.setattr("flow_llm.process_manager.reset_processing_progress", lambda model_id: None)

    async def fake_record_telemetry(**kwargs):
        return None

    monkeypatch.setattr(main, "_record_telemetry", fake_record_telemetry)

    backend_response = FakeResponse(
        json_body={
            "id": "chatcmpl-3",
            "model": "flow-model",
            "choices": [{"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
    )
    factory = FakeAsyncClientFactory(FakeAsyncClient(post_response=backend_response))
    monkeypatch.setattr(main.httpx, "AsyncClient", factory)

    client = TestClient(main.app)
    response = client.post(
        "/v1/messages",
        headers={
            "anthropic-version": "2023-06-01",
            "x-api-key": "not-checked",
            "Authorization": "Bearer something-else",
        },
        json=_base_request(),
    )

    assert response.status_code == 200
    assert factory.created[0].post_calls


def test_openai_chat_completions_passthrough_unchanged(monkeypatch):
    _install_loaded_model(monkeypatch)
    monkeypatch.setattr("flow_llm.process_manager.reset_processing_progress", lambda model_id: None)

    async def fake_record_telemetry(**kwargs):
        return None

    monkeypatch.setattr(main, "_record_telemetry", fake_record_telemetry)

    backend_json = {
        "id": "chatcmpl-openai",
        "model": "flow-model",
        "choices": [{"message": {"role": "assistant", "content": "hi"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3},
    }
    factory = FakeAsyncClientFactory(FakeAsyncClient(post_response=FakeResponse(json_body=backend_json)))
    monkeypatch.setattr(main.httpx, "AsyncClient", factory)

    client = TestClient(main.app)
    openai_request = {
        "model": "flow-model",
        "messages": [{"role": "user", "content": "Hello"}],
        "max_tokens": 32,
    }
    response = client.post("/v1/chat/completions", json=openai_request)

    assert response.status_code == 200
    assert response.json() == backend_json
    assert factory.created[0].post_calls[0]["json"] == openai_request
