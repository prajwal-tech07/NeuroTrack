import os
import joblib
import numpy as np
from typing import Dict, Any, Tuple, List, Optional
from app.core.config import settings
from app.core.logging import logger
from app.services.cv.hand_pipeline import HandPipeline
from app.services.cv.face_pipeline import FacePipeline
from app.services.cv.gait_pipeline import GaitPipeline
from app.services.cv.voice_pipeline import VoicePipeline


class ParkinsonsClassifier:
    """
    ML Model for Parkinson's Disease Screening.
    Combines Bradykinesia, 4-6 Hz Rest Tremor, Facial Hypomimia, Vocal Monotonicity, and Reduced Arm Swing.
    """

    MODEL_FILENAME = "parkinsons_model.joblib"

    def __init__(self):
        self.model = None
        self.scaler = None
        self.selector = None  # SelectKBest feature selector (set when ensemble model is loaded)
        self.pipeline = None  # Full ImbPipeline (preferred for inference when available)
        self._load_model()

    def _load_model(self):
        path = os.path.join(settings.MODEL_DIR, self.MODEL_FILENAME)
        if os.path.exists(path):
            try:
                bundle = joblib.load(path)
                self.model    = bundle.get("model")
                self.scaler   = bundle.get("scaler")
                self.selector = bundle.get("selector")   # May be None for legacy models
                self.pipeline = bundle.get("pipeline")   # Full pipeline (preferred)
                engine  = bundle.get("engine", "legacy")
                acc     = bundle.get("accuracy", None)
                acc_str = f" (accuracy={acc*100:.1f}%)" if acc else ""
                logger.info(f"Loaded Parkinson's model [{engine}]{acc_str} from {path}")
            except Exception as e:
                logger.warning(f"Could not load Parkinson's model from {path}: {e}")
        else:
            logger.info("Using calibrated probabilistic biomarker engine for Parkinson's screening.")

    POPULATION_BASELINES = {
        "hand": {
            "tapFrequencyHz": 4.5, "tapAmplitudeMean": 0.35, "tapAmplitudeDecay": 0.05,
            "tapIntervalCv": 0.12, "tapHesitations": 0, "tremorPeakHz": 9.5,
            "tremorPowerRatio": 0.04, "holdDriftPx": 0.01, "holdJitter": 0.001
        },
        "face": {
            "asymmetryIndex": 0.02, "eyeOpenAsymmetry": 0.03, "smileAmplitude": 0.22,
            "smileAmplitudeLeft": 0.22, "smileAmplitudeRight": 0.22, "browRaiseAmplitude": 0.15,
            "expressivityIndex": 0.16, "blinkRate": 18.0, "mouthOpenRange": 0.15,
            "eyeApertureLeft": 0.08, "eyeApertureRight": 0.08
        },
        "gait": {
            "cadenceStepsMin": 112.0, "stepTimeCv": 0.02, "stepSymmetry": 0.03,
            "armSwingAmplitude": 0.15, "armSwingAsymmetry": 0.08, "trunkSwayIndex": 0.02,
            "posturalLeanDeg": 4.0, "doubleSupportRatio": 0.22
        },
        "voice": {
            "jitterPercent": 0.5, "shimmerPercent": 2.0, "hnrDb": 24.0,
            "f0StdSemitones": 3.2, "pauseRatio": 0.15, "speechRateSyll": 4.8,
            "maxPhonationSec": 16.0, "intensityCv": 0.15
        }
    }

    def extract_full_features(self, modules: Dict[str, Any]) -> np.ndarray:
        """
        Combines multi-modal features for Parkinson's classifier, imputing
        neutral population baselines for unperformed modules.
        """
        hand_feat = modules.get("hand", {}).get("features") if modules.get("hand") else self.POPULATION_BASELINES["hand"]
        face_feat = modules.get("face", {}).get("features") if modules.get("face") else self.POPULATION_BASELINES["face"]
        gait_feat = modules.get("gait", {}).get("features") if modules.get("gait") else self.POPULATION_BASELINES["gait"]
        voice_feat = modules.get("voice", {}).get("features") if modules.get("voice") else self.POPULATION_BASELINES["voice"]

        x_hand = HandPipeline.extract_feature_vector(hand_feat or self.POPULATION_BASELINES["hand"])
        x_face = FacePipeline.extract_feature_vector(face_feat or self.POPULATION_BASELINES["face"])
        x_gait = GaitPipeline.extract_feature_vector(gait_feat or self.POPULATION_BASELINES["gait"])
        x_voice = VoicePipeline.extract_feature_vector(voice_feat or self.POPULATION_BASELINES["voice"])

        return np.concatenate([x_hand, x_face, x_gait, x_voice]).reshape(1, -1)

    def predict(self, modules: Dict[str, Any], age: Optional[int] = None) -> Dict[str, Any]:
        """
        Infers Parkinson's risk score (0-100), risk level, flags, and contributing factors.
        """
        hand_m = modules.get("hand")
        face_m = modules.get("face")
        gait_m = modules.get("gait")
        voice_m = modules.get("voice")

        flags: List[str] = []
        contributing_factors: List[str] = []
        biomarkers: Dict[str, Any] = {}

        # 1. Evaluate individual modalities
        sub_scores = []
        weights = []

        if hand_m and hand_m.get("completed", True):
            h_score, h_flags, _ = HandPipeline.compute_rule_score(hand_m.get("features", {}))
            q = hand_m.get("quality", 1.0)
            sub_scores.append(h_score)
            weights.append(0.35 * (0.6 + 0.4 * q))  # Hand tremor/bradykinesia carries high PD weight
            flags.extend(h_flags)
            if "hand_rest_tremor_band" in h_flags:
                contributing_factors.append("Dominant 4-6 Hz resting tremor oscillation detected")
            if "hand_bradykinesia" in h_flags:
                contributing_factors.append("Bradykinesia: slowed finger tapping speed")
            if "hand_amplitude_decrement" in h_flags:
                contributing_factors.append("Sequence effect: progressive amplitude decrement during tapping")
            biomarkers["handScore"] = h_score

        if gait_m and gait_m.get("completed", True):
            g_score, g_flags, _ = GaitPipeline.compute_rule_score(gait_m.get("features", {}))
            q = gait_m.get("quality", 1.0)
            sub_scores.append(g_score)
            weights.append(0.25 * (0.6 + 0.4 * q))
            flags.extend(g_flags)
            if "gait_reduced_arm_swing" in g_flags:
                contributing_factors.append("Reduced arm swing amplitude during gait")
            if "gait_high_variability" in g_flags:
                contributing_factors.append("Increased step time variability")
            biomarkers["gaitScore"] = g_score

        if voice_m and voice_m.get("completed", True):
            v_score, v_flags, _ = VoicePipeline.compute_rule_score(voice_m.get("features", {}), age)
            q = voice_m.get("quality", 1.0)
            sub_scores.append(v_score)
            weights.append(0.22 * (0.6 + 0.4 * q))
            flags.extend(v_flags)
            if "voice_monotone" in v_flags:
                contributing_factors.append("Vocal monotonicity (flat pitch prosody)")
            if "voice_jitter_elevated" in v_flags:
                contributing_factors.append("Elevated pitch perturbation (jitter)")
            biomarkers["voiceScore"] = v_score

        if face_m and face_m.get("completed", True):
            f_score, f_flags, _ = FacePipeline.compute_rule_score(face_m.get("features", {}))
            q = face_m.get("quality", 1.0)
            sub_scores.append(f_score)
            weights.append(0.18 * (0.6 + 0.4 * q))
            flags.extend(f_flags)
            if "face_reduced_expressivity" in f_flags:
                contributing_factors.append("Facial hypomimia (masked facies / low expressivity)")
            if "face_blink_rate_atypical" in f_flags:
                contributing_factors.append("Reduced spontaneous blink rate")
            biomarkers["faceScore"] = f_score

        if not sub_scores:
            return {
                "condition": "parkinsons",
                "score": 0,
                "riskLevel": "high",
                "riskLabel": "Insufficient Data",
                "confidence": 0.0,
                "flags": ["insufficient_data"],
                "contributingFactors": ["No usable test modules recorded"],
                "biomarkers": {},
            }

        # If trained ML model exists, use it
        if self.model is not None and self.scaler is not None:
            try:
                X = self.extract_full_features(modules)
                if self.pipeline is not None:
                    # Preferred: full pipeline handles scaling + feature selection internally
                    prob_healthy = float(self.pipeline.predict_proba(X)[0, 1])
                else:
                    # Legacy: manual transform chain
                    X_scaled = self.scaler.transform(X)
                    if self.selector is not None:
                        X_scaled = self.selector.transform(X_scaled)
                    prob_healthy = float(self.model.predict_proba(X_scaled)[0, 1])
                score = int(np.clip(prob_healthy * 100, 0, 100))
                confidence = 0.92  # Upgraded ensemble model
            except Exception as e:
                logger.error(f"Inference error in Parkinsons model: {e}")
                # Fallback to calibrated weighted heuristic
                total_w = sum(weights)
                score = int(np.clip(sum(s * w for s, w in zip(sub_scores, weights)) / total_w, 0, 100))
                confidence = 0.85
        else:
            total_w = sum(weights)
            weighted_mean = sum(s * w for s, w in zip(sub_scores, weights)) / total_w
            
            # Parkinson's penalty if rest tremor is detected
            if "hand_rest_tremor_band" in flags:
                weighted_mean -= 8.0
            if "hand_amplitude_decrement" in flags and "hand_bradykinesia" in flags:
                weighted_mean -= 6.0

            score = int(np.clip(weighted_mean, 0, 100))
            confidence = 0.86

        # Determine risk band
        if score >= 80:
            risk_level = "low"
            risk_label = "Low Risk"
        elif score >= 65:
            risk_level = "mild"
            risk_label = "Mild Risk"
        elif score >= 50:
            risk_level = "moderate"
            risk_label = "Moderate Risk"
        else:
            risk_level = "high"
            risk_label = "High Risk"

        return {
            "condition": "parkinsons",
            "score": score,
            "riskLevel": risk_level,
            "riskLabel": risk_label,
            "confidence": confidence,
            "flags": list(set(flags)),
            "contributingFactors": contributing_factors,
            "biomarkers": biomarkers,
        }
