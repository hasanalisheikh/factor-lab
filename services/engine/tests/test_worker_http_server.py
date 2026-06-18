from __future__ import annotations

import http.client
import importlib.util
import threading
from http.server import HTTPServer
from pathlib import Path

HTTP_SERVER_PATH = (
    Path(__file__).resolve().parents[1] / "factorlab_engine" / "worker" / "http_server.py"
)
HTTP_SERVER_SPEC = importlib.util.spec_from_file_location("worker_http_server", HTTP_SERVER_PATH)
assert HTTP_SERVER_SPEC is not None
assert HTTP_SERVER_SPEC.loader is not None
http_server = importlib.util.module_from_spec(HTTP_SERVER_SPEC)
HTTP_SERVER_SPEC.loader.exec_module(http_server)


def _post_trigger(port: int, authorization: str | None = None) -> http.client.HTTPResponse:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Authorization": authorization} if authorization is not None else {}
    connection.request("POST", "/trigger", headers=headers)
    return connection.getresponse()


def _run_trigger_request(
    secret: str,
    authorization: str | None = None,
) -> tuple[int, bytes, bool]:
    original_secret = http_server._TriggerHandler._secret
    http_server._TriggerHandler._secret = secret
    http_server._wakeup.clear()
    server = HTTPServer(("127.0.0.1", 0), http_server._TriggerHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        response = _post_trigger(server.server_port, authorization)
        body = response.read()
        return response.status, body, http_server._wakeup.is_set()
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
        http_server._TriggerHandler._secret = original_secret
        http_server._wakeup.clear()


def test_trigger_requires_configured_secret() -> None:
    status, body, woke_worker = _run_trigger_request(secret="")

    assert status == 503
    assert body == b"trigger secret not configured"
    assert not woke_worker


def test_trigger_rejects_invalid_bearer_token() -> None:
    status, body, woke_worker = _run_trigger_request(
        secret="expected-secret",
        authorization="Bearer wrong-secret",
    )

    assert status == 401
    assert body == b"unauthorized"
    assert not woke_worker


def test_trigger_accepts_configured_bearer_token() -> None:
    status, body, woke_worker = _run_trigger_request(
        secret="expected-secret",
        authorization="Bearer expected-secret",
    )

    assert status == 200
    assert body == b"ok"
    assert woke_worker
