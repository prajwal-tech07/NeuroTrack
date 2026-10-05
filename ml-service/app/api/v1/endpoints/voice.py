"""
Voice Parkinson's Endpoints
---------------------------

POST /api/v1/score/voice/audio
    multipart: audio=<WAV file of a sustained "Aaah">, sex=male|female (optional)
    Extracts Praat voice-report features and scores them with the model
    trained on real recordings (see scripts/train_voice_model.py).

GET  /api/v1/score/voice/status
    Whether the model is loaded, plus its subject-level validation metrics.

The audio is processed in memory and never written to disk.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.logging import logger
from app.services.audio.voice_features import VoiceQualityError
from app.services.ml.voice_audio_model import voice_audio_classifier

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=2)

MAX_AUDIO_BYTES = 8 * 1024 * 1024  # ~45 s of 16-bit mono at 48 kHz
ALLOWED_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "application/octet-stream"}


def _parse_sex(sex: Optional[str]) -> Optional[bool]:
    s = (sex or "").strip().lower()
    if s in ("male", "m"):
        return True
    if s in ("female", "f"):
        return False
    return None


@router.get("/status")
async def voice_model_status():
    clf = voice_audio_classifier
    if not clf.is_loaded:
        return {"loaded": False, "error": clf.load_error}
    b = clf.bundle
    return {
        "loaded": True,
        "engine": b["engine"],
        "trainedAt": b["trained_at"],
        "threshold": b["threshold"],
        "metrics": b["metrics"],
    }


@router.post("/audio")
async def score_voice_audio(
    audio: UploadFile = File(..., description="WAV recording of a sustained 'Aaah'"),
    sex: Optional[str] = Form(None),
):
    if not voice_audio_classifier.is_loaded:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail=voice_audio_classifier.load_error or "Voice model not loaded")
    if audio.content_type and audio.content_type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail=f"Unsupported audio type '{audio.content_type}'. Send a WAV file.")

    data = await audio.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The audio file is empty.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The audio file is too large.")

    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(_pool, voice_audio_classifier.predict_wav_bytes, data, _parse_sex(sex))
    except VoiceQualityError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.exception("Voice audio scoring failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Voice scoring failed: {exc}")
