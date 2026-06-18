from __future__ import annotations

import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

_wakeup = threading.Event()


class _TriggerHandler(BaseHTTPRequestHandler):
    _secret: str = os.getenv("WORKER_TRIGGER_SECRET", "")

    def do_GET(self) -> None:
        if self.path == "/health":
            self._respond(200, b"ok")
        else:
            self._respond(404, b"not found")

    def do_POST(self) -> None:
        if self.path != "/trigger":
            self._respond(404, b"not found")
            return
        if not self._secret:
            self._respond(503, b"trigger secret not configured")
            return
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {self._secret}":
            self._respond(401, b"unauthorized")
            return
        _wakeup.set()
        self._respond(200, b"ok")

    def _respond(self, code: int, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        pass  # suppress access logs


def _start_trigger_server(port: int) -> None:
    server = HTTPServer(("0.0.0.0", port), _TriggerHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[engine] trigger server on :{port}")
