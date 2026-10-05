from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from app.core.logging import logger


def setup_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        logger.error(f"Unhandled error processing {request.method} {request.url.path}: {str(exc)}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": "InternalServerError",
                "message": str(exc),
            },
        )
