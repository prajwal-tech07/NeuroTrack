from fastapi import APIRouter
from app.api.v1.endpoints import health, score, face_photo, voice

api_router = APIRouter()
api_router.include_router(health.router, tags=["Health"])
api_router.include_router(score.router, prefix="/score", tags=["Scoring"])
api_router.include_router(face_photo.router, prefix="/score", tags=["Face Photo"])
api_router.include_router(voice.router, prefix="/score/voice", tags=["Voice"])
