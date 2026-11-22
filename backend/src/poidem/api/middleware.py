import logging
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("poidem.requests")


class BodyLimitMiddleware:
    """Ограничение также для chunked body, до JSON/multipart-разбора."""

    def __init__(self, app: ASGIApp, photo_max_bytes: int):
        self.app = app
        self.photo_max_bytes = photo_max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH", "DELETE"}:
            await self.app(scope, receive, send)
            return
        from starlette.requests import Request

        from poidem.api.errors import AppError, error_response

        limit = self.photo_max_bytes + 65536 if scope["path"] == "/api/v1/me/photos" else 16384
        parts = []
        length = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            data = message.get("body", b"")
            length += len(data)
            if length > limit:
                await error_response(
                    Request(scope),
                    AppError(413, "REQUEST_TOO_LARGE", "Размер запроса превышает допустимый"),
                )(scope, receive, send)
                return
            parts.append(data)
            if not message.get("more_body", False):
                break
        body = b"".join(parts)
        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


class ExceptionBoundaryMiddleware:
    """Обрабатывает неожиданный сбой внутри CORS и request-контекста."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        started = False

        async def track_start(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, track_start)
        except Exception as exc:
            if scope["type"] != "http" or started:
                raise
            from starlette.requests import Request

            from poidem.api.errors import internal_error_response

            await internal_error_response(Request(scope), exc)(scope, receive, send)


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        started = time.perf_counter()
        status = 500

        async def send_with_headers(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Cache-Control"] = "no-store"
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        finally:
            route = scope.get("route")
            # Для 404 не журналируем пользовательский path и query string.
            logger.info(
                "request_completed",
                extra={
                    "request_id": request_id,
                    "method": scope["method"],
                    "route": getattr(route, "path", "unmatched"),
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )


class ExactHostMiddleware:
    """Единый формат 400, без HTML-ответа стандартного TrustedHostMiddleware."""

    def __init__(self, app: ASGIApp, allowed_hosts: list[str]):
        self.app = app
        self.allowed_hosts = set(allowed_hosts)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            host = Headers(scope=scope).get("host", "").split(":", 1)[0].lower()
            if host not in self.allowed_hosts:
                from starlette.requests import Request

                from poidem.api.errors import AppError, error_response

                response = error_response(
                    Request(scope), AppError(400, "INVALID_HOST", "Недопустимый Host")
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
