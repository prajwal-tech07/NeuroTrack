"""
Voice Parkinson's Prediction Endpoints
--------------------------------------

POST /api/v1/score/voice/predict
    Accepts the exact 22 numerical features used during training.
    Returns: { prediction, probability, model_accuracy }

POST /api/v1/score/voice/predict-wav   (stub — WAV extraction not yet implemented)
    Placeholder for future WAV audio upload → feature extraction → prediction.

GET  /api/v1/score/voice/status
    Reports whether the voice model loaded successfully.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from app.services.ml.voice_classifier import voice_classifier, VOICE_FEATURE_NAMES
from app.core.logging import logger

router = APIRouter()

EXPECTED_FEATURE_COUNT = len(VOICE_FEATURE_NAMES)  # 22


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class VoiceFeaturePredictRequest(BaseModel):
    """
    Direct 22-feature input for model verification.
    Features must be supplied in the canonical training order.
    """
    features: List[float] = Field(
        ...,
        min_length=EXPECTED_FEATURE_COUNT,
        max_length=EXPECTED_FEATURE_COUNT,
        description=(
            f"Exactly {EXPECTED_FEATURE_COUNT} numerical voice features in training order: "
            + ", ".join(VOICE_FEATURE_NAMES)
        ),
        examples=[[
            119.992, 157.302, 74.997,
            0.00784, 0.00007, 0.00370,
            0.00554, 0.01109,
            0.04374, 0.42600,
            0.02182, 0.03130, 0.02971, 0.06545,
            0.02211, 21.033,
            0.414783, 0.815285,
            -4.813031, 0.266482, 2.301442, 0.284654
        ]]
    )

    @field_validator("features")
    @classmethod
    def validate_feature_count(cls, v: List[float]) -> List[float]:
        if len(v) != EXPECTED_FEATURE_COUNT:
            raise ValueError(
                f"Exactly {EXPECTED_FEATURE_COUNT} features required, got {len(v)}. "
                f"Required order: {VOICE_FEATURE_NAMES}"
            )
        return v


class VoicePredictionResponse(BaseModel):
    prediction: str = Field(..., description="'healthy' or 'parkinsons'")
    probability: float = Field(..., description="Model probability of Parkinson's class")
    model_accuracy: Optional[float] = Field(None, description="Evaluation accuracy from training")


class VoiceModelStatusResponse(BaseModel):
    loaded: bool
    model_path: str
    feature_count: int
    feature_names: List[str]
    model_accuracy: Optional[float]
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status", response_model=VoiceModelStatusResponse, tags=["Voice"])
async def voice_model_status():
    """
    Reports the current load status of the Parkinson's voice model.
    Use this to verify that voice_model.joblib was found and loaded correctly.
    """
    return VoiceModelStatusResponse(
        loaded=voice_classifier.is_loaded,
        model_path=voice_classifier.MODEL_PATH,
        feature_count=EXPECTED_FEATURE_COUNT,
        feature_names=VOICE_FEATURE_NAMES,
        model_accuracy=voice_classifier.model_accuracy,
        error=voice_classifier.load_error,
    )


@router.post("/predict", response_model=VoicePredictionResponse, tags=["Voice"])
async def predict_voice_features(payload: VoiceFeaturePredictRequest):
    """
    **Test / verification endpoint.**

    Accepts the 22 voice features directly (no WAV file needed) and returns
    the real prediction from the Colab-exported model.

    Feature order (must match training):
    1. MDVP:Fo          — Average vocal fundamental frequency
    2. MDVP:Fhi         — Maximum vocal fundamental frequency
    3. MDVP:Flo         — Minimum vocal fundamental frequency
    4. MDVP:Jitter(%)   — Jitter percentage
    5. MDVP:Jitter(Abs) — Absolute jitter
    6. MDVP:RAP         — Relative amplitude perturbation
    7. MDVP:PPQ         — Five-point period perturbation quotient
    8. Jitter:DDP       — Average absolute difference of differences of periods
    9. MDVP:Shimmer     — Shimmer
    10. MDVP:Shimmer(dB)— Shimmer in dB
    11. Shimmer:APQ3    — Three-point amplitude perturbation quotient
    12. Shimmer:APQ5    — Five-point amplitude perturbation quotient
    13. MDVP:APQ        — 11-point amplitude perturbation quotient
    14. Shimmer:DDA     — Average absolute differences between consecutive differences
    15. NHR             — Noise-to-harmonics ratio
    16. HNR             — Harmonics-to-noise ratio
    17. RPDE            — Recurrence period density entropy
    18. DFA             — Detrended fluctuation analysis
    19. spread1         — Nonlinear measure of fundamental frequency variation
    20. spread2         — Nonlinear measure of fundamental frequency variation
    21. D2              — Correlation dimension
    22. PPE             — Pitch period entropy
    """
    if not voice_classifier.is_loaded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "VoiceModelNotLoaded",
                "message": voice_classifier.load_error or "Voice model failed to load at startup.",
                "hint": "Ensure ml/voice_model.joblib exists and is a valid joblib bundle.",
            },
        )

    try:
        result = voice_classifier.predict_from_features(payload.features)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "InvalidFeatures", "message": str(exc)},
        )
    except RuntimeError as exc:
        logger.error(f"Voice inference error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "InferenceError", "message": str(exc)},
        )

    return VoicePredictionResponse(**result)


@router.post("/predict-wav", tags=["Voice"])
async def predict_voice_wav():
    """
    **Placeholder — WAV feature extraction not yet implemented.**

    Future implementation will:
    1. Accept a WAV file upload.
    2. Extract the 22 MDVP/nonlinear acoustic features.
    3. Pass them through the loaded pipeline.
    4. Return { prediction, probability, model_accuracy }.

    This stub returns 501 until the extraction layer is integrated.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={
            "error": "NotImplemented",
            "message": (
                "WAV audio feature extraction is not yet implemented. "
                "Use POST /api/v1/score/voice/predict with the 22 raw features to test the model."
            ),
        },
    )
