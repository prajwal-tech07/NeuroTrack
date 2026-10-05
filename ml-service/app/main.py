from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.errors import setup_exception_handlers
from app.api.v1.router import api_router


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version="2.0.0",
        description="Multimodal ML Screening Engine for Parkinson's Disease & Paralysis/Stroke",
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Errors
    setup_exception_handlers(app)

    # Routes
    app.include_router(api_router, prefix=settings.API_V1_STR)

    return app


app = create_app()
