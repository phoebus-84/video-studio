"""Declared and streaming request-body safety tests."""

from __future__ import annotations

import asyncio
import json

from qwen_tts_worker.app import RequestBodyLimitMiddleware


def test_chunked_body_cannot_bypass_limit() -> None:
    called = False
    async def inner(scope, receive, send):
        nonlocal called; called = True
    middleware = RequestBodyLimitMiddleware(inner, maximum_bytes=1024)
    incoming = iter([
        {"type": "http.request", "body": b"a" * 600, "more_body": True},
        {"type": "http.request", "body": b"b" * 600, "more_body": False},
    ])
    sent = []
    async def receive(): return next(incoming)
    async def send(message): sent.append(message)
    scope = {"type": "http", "method": "POST", "headers": [(b"transfer-encoding", b"chunked")]}
    asyncio.run(middleware(scope, receive, send))
    assert called is False
    assert sent[0]["status"] == 413
    body = json.loads(sent[1]["body"])
    assert body["detail"][0]["type"] == "request_too_large"


def test_bounded_stream_is_replayed_exactly() -> None:
    observed = bytearray()
    async def inner(scope, receive, send):
        while True:
            message = await receive(); observed.extend(message.get("body", b""))
            if not message.get("more_body", False): break
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})
    middleware = RequestBodyLimitMiddleware(inner, maximum_bytes=1024)
    incoming = iter([
        {"type": "http.request", "body": b"hello ", "more_body": True},
        {"type": "http.request", "body": b"world", "more_body": False},
    ])
    sent = []
    async def receive(): return next(incoming)
    async def send(message): sent.append(message)
    scope = {"type": "http", "method": "PATCH", "headers": []}
    asyncio.run(middleware(scope, receive, send))
    assert observed == b"hello world"
    assert sent[0]["status"] == 204
