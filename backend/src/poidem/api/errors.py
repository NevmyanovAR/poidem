import logging
import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

logger = logging.getLogger("poidem.errors")


@dataclass
class AppError(Exception):
    status_code: int
    code: str
    message: str
    fields: dict[str, str] = field(default_factory=dict)


def error_response(request: Request, error: AppError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    headers = {"X-Request-ID": request_id, "Cache-Control": "no-store"}
    if error.status_code == 429:
        headers["Retry-After"] = "60"
    return JSONResponse(
        status_code=error.status_code,
        headers=headers,
        content={
            "error": {
                "code": error.code,
                "message": error.message,
                "fields": error.fields,
                "details": {},
                "request_id": request_id,
            }
        },
    )


def internal_error_response(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "unexpected_error",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "error_type": type(exc).__name__,
        },
    )
    return error_response(request, AppError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера"))


def register_errors(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def application_error(request: Request, exc: AppError) -> JSONResponse:
        return error_response(request, exc)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # errors() содержит input и ctx с пользовательским вводом — не выдаём их.
        return error_response(request, AppError(422, "VALIDATION_ERROR", "Проверьте поля запроса"))

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code, message = {
            404: ("RESOURCE_NOT_FOUND", "Ресурс не найден"),
            405: ("METHOD_NOT_ALLOWED", "Метод не поддерживается"),
            401: ("AUTH_REQUIRED", "Необходим вход через Telegram"),
            403: ("ACCESS_DENIED", "Недостаточно прав"),
        }.get(exc.status_code, ("REQUEST_REJECTED", "Запрос отклонён"))
        response = error_response(request, AppError(exc.status_code, code, message))
        if exc.status_code == 405 and exc.headers and "Allow" in exc.headers:
            response.headers["Allow"] = exc.headers["Allow"]
        return response

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        logger.warning(
            "database_error",
            extra={
                "request_id": getattr(request.state, "request_id", None),
                "error_type": type(exc).__name__,
            },
        )
        return error_response(
            request, AppError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен")
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        return internal_error_response(request, exc)
