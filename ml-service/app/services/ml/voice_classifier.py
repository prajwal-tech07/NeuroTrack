"""
VoiceClassifier
---------------
Loads the Parkinson's voice model exported from Google Colab:
    ml/voice_model.joblib

Expected bundle format:
    {
        "pipeline": <sklearn/XGBoost Pipeline>,
        "label_map": {0: "healthy", 1: "parkinsons"},
        "accuracy": <float>
    }

The pipeline already contains preprocessing + XGBoost classifier.
Do NOT retrain or modify the model here.
"""

import os
import joblib
import numpy as np
from typing import Dict, Any, List, Optional
from app.core.logging import logger

# ---------------------------------------------------------------------------
# Canonical 22-feature order — MUST match the training dataset column order.
# ---------------------------------------------------------------------------
VOICE_FEATURE_NAMES: List[str] = [
    "MDVP:Fo",
    "MDVP:Fhi",
    "MDVP:Flo",
    "MDVP:Jitter(%)",
    "MDVP:Jitter(Abs)",
    "MDVP:RAP",
    "MDVP:PPQ",
    "Jitter:DDP",
    "MDVP:Shimmer",
    "MDVP:Shimmer(dB)",
    "Shimmer:APQ3",
    "Shimmer:APQ5",
    "MDVP:APQ",
    "Shimmer:DDA",
    "NHR",
    "HNR",
    "RPDE",
    "DFA",
    "spread1",
    "spread2",
    "D2",
    "PPE",
]

# Path to the Colab-exported model, relative to the ml-service root.
# The file is expected at:  ml-service/ml/voice_model.joblib
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))               # app/services/ml/
_ML_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_THIS_DIR)))  # ml-service/
_DEFAULT_MODEL_PATH = os.path.join(_ML_SERVICE_ROOT, "ml", "voice_model.joblib")


class VoiceClassifier:
    """
    Wraps the Colab-exported Parkinson's voice model.

    Usage
    -----
    clf = VoiceClassifier()
    result = clf.predict_from_features([feature_value_1, ..., feature_value_22])
    # -> {"prediction": "healthy"|"parkinsons", "probability": float, "model_accuracy": float}
    """

    MODEL_PATH: str = _DEFAULT_MODEL_PATH

    def __init__(self, model_path: Optional[str] = None):
        self._model_path = model_path or self.MODEL_PATH
        self._pipeline = None
        self._label_map: Dict[int, str] = {0: "healthy", 1: "parkinsons"}
        self._model_accuracy: Optional[float] = None
        self._loaded: bool = False
        self._load_error: Optional[str] = None
        self._load_model()

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------

    def _load_model(self) -> None:
        """Load voice_model.joblib from disk. Called once at startup."""
        path = self._model_path
        if not os.path.exists(path):
            msg = (
                f"Voice model file not found: {path}. "
                "Place ml/voice_model.joblib in the ml-service root before starting the service."
            )
            logger.error(msg)
            self._load_error = msg
            return

        try:
            bundle = joblib.load(path)
        except Exception as exc:
            msg = f"Failed to load voice model from {path}: {exc}"
            logger.error(msg)
            self._load_error = msg
            return

        # Validate bundle structure
        if not isinstance(bundle, dict):
            msg = (
                f"voice_model.joblib must be a dict with keys "
                "'pipeline', 'label_map', 'accuracy'. Got: {type(bundle)}"
            )
            logger.error(msg)
            self._load_error = msg
            return

        pipeline = bundle.get("pipeline")
        if pipeline is None:
            msg = "voice_model.joblib bundle is missing the 'pipeline' key."
            logger.error(msg)
            self._load_error = msg
            return

        self._pipeline = pipeline
        self._label_map = bundle.get("label_map", {0: "healthy", 1: "parkinsons"})
        self._model_accuracy = bundle.get("accuracy")
        self._loaded = True

        acc_str = f" (eval accuracy={self._model_accuracy * 100:.2f}%)" if self._model_accuracy else ""
        logger.info(f"[VoiceClassifier] Loaded voice model from {path}{acc_str}")

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def predict_from_features(self, features: List[float]) -> Dict[str, Any]:
        """
        Run inference using the 22 raw voice features in canonical order.

        Parameters
        ----------
        features : list of 22 floats
            Values must be provided in VOICE_FEATURE_NAMES order.

        Returns
        -------
        dict with keys: prediction, probability, model_accuracy
        """
        # Guard: model loaded?
        if not self._loaded:
            raise RuntimeError(
                f"Voice model is not loaded. Reason: {self._load_error or 'unknown'}"
            )

        # Guard: correct feature count
        if features is None:
            raise ValueError("No features provided.")
        if len(features) != len(VOICE_FEATURE_NAMES):
            raise ValueError(
                f"Expected exactly {len(VOICE_FEATURE_NAMES)} features, "
                f"got {len(features)}. "
                f"Required order: {VOICE_FEATURE_NAMES}"
            )

        # Guard: all values must be numeric
        try:
            X = np.array(features, dtype=np.float64).reshape(1, -1)
        except (ValueError, TypeError) as exc:
            raise ValueError(f"All feature values must be numeric floats: {exc}") from exc

        if not np.all(np.isfinite(X)):
            bad = [
                VOICE_FEATURE_NAMES[i]
                for i, v in enumerate(X[0])
                if not np.isfinite(v)
            ]
            raise ValueError(
                f"Feature values must be finite (no NaN/Inf). "
                f"Problematic features: {bad}"
            )

        # Run the pipeline
        try:
            proba = self._pipeline.predict_proba(X)  # shape (1, n_classes)
        except Exception as exc:
            raise RuntimeError(f"Model inference failed: {exc}") from exc

        # Determine which class index corresponds to "parkinsons"
        # label_map: {0: "healthy", 1: "parkinsons"}
        # We want the probability of the POSITIVE class (parkinsons = 1)
        parkinsons_class_idx = None
        for idx, label in self._label_map.items():
            if label == "parkinsons":
                parkinsons_class_idx = idx
                break

        if parkinsons_class_idx is None or parkinsons_class_idx >= proba.shape[1]:
            # Fallback: assume class 1 is parkinsons
            parkinsons_class_idx = min(1, proba.shape[1] - 1)

        prob_parkinsons = float(proba[0, parkinsons_class_idx])

        # Hard prediction from pipeline
        predicted_int = int(self._pipeline.predict(X)[0])
        prediction_label = self._label_map.get(predicted_int, str(predicted_int))

        return {
            "prediction": prediction_label,
            "probability": round(prob_parkinsons, 6),
            "model_accuracy": self._model_accuracy,
        }

    # ------------------------------------------------------------------
    # Convenience helpers
    # ------------------------------------------------------------------

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    @property
    def model_accuracy(self) -> Optional[float]:
        return self._model_accuracy

    @property
    def feature_names(self) -> List[str]:
        return list(VOICE_FEATURE_NAMES)


# Module-level singleton — imported by the endpoint router.
voice_classifier = VoiceClassifier()
