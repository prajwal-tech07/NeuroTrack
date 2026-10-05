"""
face_classifier.py -- ML-based Face Biomarker Classifier
=========================================================

Classifies facial features extracted by FacePipeline into 3 neurological categories:
  - Parkinson's Hypomimia (reduced expressivity + reduced blink rate)
  - Stroke / Bell's Palsy (facial asymmetry + unilateral paresis)
  - Healthy

Falls back to rule-based scoring from FacePipeline if the ML model is not loaded.

NOTE: face_model.joblib was trained on SYNTHETIC feature distributions
(scripts/train_face_model.py), not on recordings of real patients. Its
held-out "accuracy" only measures how well it separates those synthetic
distributions, so it is not reported as a real-world accuracy anywhere.
"""

import os
import joblib
import numpy as np
from typing import Dict, Any, List, Optional, Tuple

from app.core.config import settings
from app.core.logging import logger
from app.services.cv.face_pipeline import FacePipeline


# Label constants matching train_face_model.py
LABEL_HYPOMIMIA = 0
LABEL_PALSY     = 1
LABEL_HEALTHY   = 2

LABEL_MAP = {
    LABEL_HYPOMIMIA: "hypomimia",
    LABEL_PALSY:     "facial_palsy",
    LABEL_HEALTHY:   "healthy",
}

CLASS_DISPLAY = {
    "hypomimia":    "Parkinson's Hypomimia (Masked Facies)",
    "facial_palsy": "Facial Palsy / Stroke (Asymmetric Paresis)",
    "healthy":      "Healthy",
}


class FaceClassifier:
    """
    ML Face Biomarker Classifier.

    Uses a trained VotingEnsemble (GradientBoosting + RandomForest + SVC)
    to classify facial biomarker features into neurological risk categories.
    """

    MODEL_FILENAME = "face_model.joblib"

    def __init__(self):
        self.pipeline  = None   # Full ImbPipeline (preferred)
        self.model     = None   # VotingClassifier (fallback)
        self.scaler    = None
        self.selector  = None
        self.label_map: Dict[int, str] = LABEL_MAP
        self.accuracy: Optional[float] = None
        self._load_model()

    def _load_model(self):
        path = os.path.join(settings.MODEL_DIR, self.MODEL_FILENAME)
        if os.path.exists(path):
            try:
                bundle         = joblib.load(path)
                self.pipeline  = bundle.get("pipeline")
                self.model     = bundle.get("model")
                self.scaler    = bundle.get("scaler")
                self.selector  = bundle.get("selector")
                self.label_map = bundle.get("label_map", LABEL_MAP)
                self.accuracy  = bundle.get("accuracy")
                engine = bundle.get("engine", "face-ensemble")
                logger.info(f"Loaded Face model [{engine}] from {path} (trained on synthetic data)")
            except Exception as e:
                logger.warning(f"Could not load Face model from {path}: {e}")
        else:
            logger.info("Face ML model not found. Using rule-based FacePipeline scoring.")

    @property
    def is_loaded(self) -> bool:
        return self.pipeline is not None or self.model is not None

    def predict(
        self,
        features: Dict[str, Any],
        threshold_confidence: float = 0.50,
    ) -> Dict[str, Any]:
        """
        Classifies face biomarker features.

        Args:
            features: Dict of face biomarker measurements from FacePipeline.
            threshold_confidence: Minimum confidence to trust the ML prediction.

        Returns:
            Dict with:
              - condition: "hypomimia" | "facial_palsy" | "healthy"
              - conditionLabel: human-readable label
              - probabilities: {label: probability}
              - confidence: max class probability
              - mlScore: 0-100 health score (100 = healthy)
              - ruleScore: rule-based score from FacePipeline
              - finalScore: blended score (ML + rule, weighted by confidence)
              - flags: list of clinical flag strings
              - indicators: list of indicator dicts
        """
        # Always compute the rule-based score for comparison / fallback
        rule_score, flags, indicators = FacePipeline.compute_rule_score(features)

        if not self.is_loaded:
            return {
                "condition":      "unknown",
                "conditionLabel": "Rule-Based (ML model not loaded)",
                "probabilities":  {},
                "confidence":     0.0,
                "mlScore":        rule_score,
                "ruleScore":      rule_score,
                "finalScore":     rule_score,
                "flags":          flags,
                "indicators":     indicators,
                "engine":         "rule-based",
            }

        # Extract feature vector (matches FacePipeline.FEATURE_NAMES order)
        X_raw = FacePipeline.extract_feature_vector(features).reshape(1, -1)

        try:
            if self.pipeline is not None:
                proba = self.pipeline.predict_proba(X_raw)[0]
            else:
                X_scaled = self.scaler.transform(X_raw)
                if self.selector is not None:
                    X_scaled = self.selector.transform(X_scaled)
                proba = self.model.predict_proba(X_scaled)[0]

            pred_label_idx = int(np.argmax(proba))
            confidence     = float(proba[pred_label_idx])
            condition      = self.label_map.get(pred_label_idx, "unknown")

            # Build probability dict keyed by string label
            prob_dict = {
                self.label_map.get(i, str(i)): float(p)
                for i, p in enumerate(proba)
            }

            # ML score: probability of healthy × 100
            healthy_idx = [k for k, v in self.label_map.items() if v == "healthy"]
            prob_healthy = float(proba[healthy_idx[0]]) if healthy_idx else 0.5
            ml_score     = int(np.clip(prob_healthy * 100, 0, 100))

            # Blend ML score with rule-based score weighted by confidence
            # High-confidence ML result dominates; low confidence uses more rule-based
            ml_weight   = min(0.85, confidence)
            rule_weight = 1.0 - ml_weight
            final_score = int(np.clip(ml_score * ml_weight + rule_score * rule_weight, 0, 100))

        except Exception as e:
            logger.error(f"FaceClassifier inference error: {e}")
            return {
                "condition":      "unknown",
                "conditionLabel": "Inference Error (using rule-based fallback)",
                "probabilities":  {},
                "confidence":     0.0,
                "mlScore":        rule_score,
                "ruleScore":      rule_score,
                "finalScore":     rule_score,
                "flags":          flags,
                "indicators":     indicators,
                "engine":         "rule-based-fallback",
            }

        return {
            "condition":      condition,
            "conditionLabel": CLASS_DISPLAY.get(condition, condition),
            "probabilities":  prob_dict,
            "confidence":     round(confidence, 4),
            "mlScore":        ml_score,
            "ruleScore":      rule_score,
            "finalScore":     final_score,
            "flags":          flags,
            "indicators":     indicators,
            "engine":         "face-ensemble-synthetic-v1",
        }


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------
face_classifier = FaceClassifier()
