"""
face_photo.py — Face Photo Upload Endpoint
===========================================

POST /api/v1/score/face-photo

Accepts an uploaded image (JPEG/PNG), runs:
  Image → OpenCV Face Detection → MediaPipe Face Mesh landmarks
  → FacePipeline feature extraction → FaceClassifier prediction

Returns a structured Parkinson's-related facial analysis result.
The FaceClassifier falls back to rule-based scoring if the trained
model file (ml/face_model.joblib) is not yet present.
"""

import io
import numpy as np
from fastapi import APIRouter, UploadFile, File, HTTPException, status
from typing import Any, Dict

from app.core.logging import logger
from app.services.ml.face_classifier import face_classifier
from app.services.cv.face_pipeline import FacePipeline

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers — lazy imports so the service still starts if these libs are absent
# ---------------------------------------------------------------------------

def _load_image_bgr(data: bytes) -> np.ndarray:
    """Decode raw image bytes → BGR numpy array via OpenCV."""
    try:
        import cv2
        arr = np.frombuffer(data, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image. Make sure it is a valid JPEG or PNG.")
        return img
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenCV is not installed on the ML service. Run: pip install opencv-python-headless",
        )


def _detect_faces_count(img_bgr: np.ndarray) -> int:
    """Return number of frontal faces found via Haar cascade."""
    import cv2
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    return len(faces)


def _extract_landmarks_mediapipe(img_bgr: np.ndarray) -> Dict[str, Any]:
    """
    Run MediaPipe Face Mesh on the image and return a dict of facial features
    compatible with FacePipeline (same keys used by the live recording path).

    Returns None if no face mesh is detected.
    """
    try:
        import mediapipe as mp
        import cv2
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="mediapipe is not installed on the ML service. Run: pip install mediapipe",
        )

    mp_face_mesh = mp.solutions.face_mesh

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    h, w = img_rgb.shape[:2]

    with mp_face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
    ) as face_mesh:
        results = face_mesh.process(img_rgb)

    if not results.multi_face_landmarks:
        return None

    lm = results.multi_face_landmarks[0].landmark  # 478 landmarks

    def dist(a, b):
        """Euclidean distance between two landmarks (normalised coords)."""
        return float(np.sqrt((lm[a].x - lm[b].x) ** 2 + (lm[a].y - lm[b].y) ** 2))

    # -----------------------------------------------------------------------
    # Landmark index references (MediaPipe 478-point mesh):
    # Left eye:  33 (outer), 159 (upper), 145 (lower), 133 (inner)
    # Right eye: 362 (outer), 386 (upper), 374 (lower), 263 (inner)
    # Mouth:     61 (left), 291 (right), 13 (upper), 14 (lower)
    # Brow L:    70 (arch), brow R: 300 (arch)
    # -----------------------------------------------------------------------

    # Eye aperture (vertical gap)
    eye_ap_left  = dist(159, 145)
    eye_ap_right = dist(386, 374)

    # Mouth width and openness
    mouth_width = dist(61, 291)
    mouth_open  = dist(13, 14)
    smile_amp   = max(0.0, mouth_width - 0.25) / 0.15   # rough normalisation

    # Brow raise (brow tip vs eye outer corner, vertical)
    brow_left  = abs(lm[70].y - lm[33].y)
    brow_right = abs(lm[300].y - lm[362].y)

    # Asymmetry: difference between left and right landmark y-positions
    # Using midline landmarks: nose tip = 4
    nose_x = lm[4].x
    # Sum squared horizontal distance from midline for symmetric pairs
    sym_pairs = [(33, 362), (159, 386), (61, 291), (70, 300), (145, 374)]
    asym_vals = []
    for la, rb in sym_pairs:
        d_left  = abs(lm[la].x - nose_x)
        d_right = abs(lm[rb].x - nose_x)
        ratio   = abs(d_left - d_right) / max(d_left + d_right, 1e-4)
        asym_vals.append(ratio)
    asymmetry_index = float(np.mean(asym_vals))

    eye_open_asym = abs(eye_ap_left - eye_ap_right) / max(eye_ap_left + eye_ap_right, 1e-4)

    # Expressivity: combined normalised range of movement proxies
    expressivity = float(np.clip(
        (smile_amp * 0.4 + (brow_left + brow_right) * 2 * 0.3 + mouth_open / (mouth_width + 1e-4) * 0.3),
        0.0, 1.0,
    ))

    # blink_rate cannot be computed from a single static image → set to a
    # population average (15/min) so the rule-scorer treats it as neutral.
    blink_rate = 15.0

    return {
        "blinkRate":           blink_rate,
        "blinkCount":          None,
        "expressivityIndex":   round(expressivity, 4),
        "smileAmplitude":      round(float(np.clip(smile_amp, 0, 1)), 4),
        "smileAmplitudeLeft":  round(float(np.clip(smile_amp, 0, 1)), 4),
        "smileAmplitudeRight": round(float(np.clip(smile_amp, 0, 1)), 4),
        "browRaiseAmplitude":  round(float((brow_left + brow_right) / 2), 4),
        "browRaiseLeft":       round(float(brow_left), 4),
        "browRaiseRight":      round(float(brow_right), 4),
        "asymmetryIndex":      round(asymmetry_index, 4),
        "mouthOpenRange":      round(float(mouth_open), 4),
        "eyeApertureLeft":     round(float(eye_ap_left), 4),
        "eyeApertureRight":    round(float(eye_ap_right), 4),
        "eyeOpenAsymmetry":    round(float(eye_open_asym), 4),
        "eyeApertureCv":       None,
        "trackedRatio":        1.0,
        "brightness":          None,
        "frameCount":          1,
        "durationSec":         0.0,
    }


def _risk_score_to_parkinson(final_score: int, condition: str, probabilities: Dict) -> int:
    """
    Convert the health score (0-100, higher=healthier) to a Parkinson's
    risk percentage (0-100, higher=more indicators detected).

    If the ML model returned per-class probabilities, we use the
    hypomimia probability directly; otherwise we invert the health score.
    """
    hypo_prob = probabilities.get("hypomimia")
    if hypo_prob is not None:
        return int(round(hypo_prob * 100))
    # Invert: health score 100 → 0% risk, health score 0 → 100% risk
    return int(round(max(0, min(100, 100 - final_score))))


def _build_prediction_label(parkinson_pct: int) -> str:
    if parkinson_pct >= 60:
        return "Higher Parkinson's-related indicators"
    return "Lower Parkinson's-related indicators"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

ACCEPTED_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png"}
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/face-photo")
async def analyze_face_photo(image: UploadFile = File(...)):
    """
    Parkinson's-related facial analysis from a single uploaded photo.

    Pipeline:
      Image bytes → OpenCV face detection (count check)
      → MediaPipe Face Mesh (landmark extraction)
      → FacePipeline feature vector
      → FaceClassifier (ML model or rule-based fallback)
      → Structured result

    DISCLAIMER: This is an AI-based screening tool only.
    It does NOT constitute a medical diagnosis.
    """

    # 1. Validate MIME type
    if image.content_type not in ACCEPTED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{image.content_type}'. Please upload a JPEG or PNG image.",
        )

    # 2. Read bytes & check size
    data = await image.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File is too large ({len(data) // (1024*1024)} MB). Maximum allowed size is 10 MB.",
        )

    # 3. Decode image
    try:
        img_bgr = _load_image_bgr(data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # 4. Face count check
    try:
        face_count = _detect_faces_count(img_bgr)
    except Exception as e:
        logger.error(f"Face detection error: {e}")
        face_count = -1  # unknown — allow to proceed with landmark step

    if face_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No clear face detected in the image. Please upload a well-lit, front-facing photo.",
        )
    if face_count > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{face_count} faces detected. Please upload a photo containing only one person.",
        )

    # 5. MediaPipe landmark extraction
    try:
        features = _extract_landmarks_mediapipe(img_bgr)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"MediaPipe landmark extraction error: {e}")
        features = None

    if features is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Could not extract facial landmarks from the image. "
                "Please upload a clear, well-lit, front-facing photo with your entire face visible."
            ),
        )

    # 6. ML / rule-based classification
    try:
        clf_result = face_classifier.predict(features)
    except Exception as e:
        logger.error(f"FaceClassifier error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Model prediction error: {str(e)}",
        )

    # 7. Build response
    parkinson_pct = _risk_score_to_parkinson(
        clf_result["finalScore"],
        clf_result["condition"],
        clf_result.get("probabilities", {}),
    )
    confidence_pct = clf_result.get("confidence", 0.0)
    prediction_label = _build_prediction_label(parkinson_pct)

    return {
        "parkinsonsRiskScore": parkinson_pct,
        "confidence": round(confidence_pct, 4),
        "prediction": prediction_label,
        "condition": clf_result.get("condition", "unknown"),
        "conditionLabel": clf_result.get("conditionLabel", "Unknown"),
        "faceDetected": True,
        "faceCount": face_count,
        "features": features,
        "finalScore": clf_result.get("finalScore", 0),
        "mlScore": clf_result.get("mlScore"),
        "ruleScore": clf_result.get("ruleScore"),
        "flags": clf_result.get("flags", []),
        "indicators": clf_result.get("indicators", []),
        "engine": clf_result.get("engine", "rule-based"),
    }
