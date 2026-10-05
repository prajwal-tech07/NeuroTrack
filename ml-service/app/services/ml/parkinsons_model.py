import numpy as np
from typing import Dict, Any, Tuple, List, Optional
from app.services.ml.confidence import coverage_confidence
from app.services.cv.hand_pipeline import HandPipeline
from app.services.cv.face_pipeline import FacePipeline
from app.services.cv.gait_pipeline import GaitPipeline
from app.services.cv.voice_pipeline import VoicePipeline


class ParkinsonsClassifier:
    """
    Rule-based Parkinson's Disease screening engine.
    Combines Bradykinesia, 4-6 Hz Rest Tremor, Facial Hypomimia, Vocal Monotonicity, and Reduced Arm Swing.
    """

    # This classifier is a transparent rule-based engine. An earlier version
    # loaded a model trained on synthetic data (and, by accident, a 22-feature
    # voice model that crashed on the 36-feature input and silently fell back to
    # these rules). Real-data ML for voice lives in voice_audio_classifier.py.
    ENGINE = "rule-based"

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

        total_w = sum(weights)
        weighted_mean = sum(s * w for s, w in zip(sub_scores, weights)) / total_w

        # Parkinson's penalty if rest tremor is detected
        if "hand_rest_tremor_band" in flags:
            weighted_mean -= 8.0
        if "hand_amplitude_decrement" in flags and "hand_bradykinesia" in flags:
            weighted_mean -= 6.0

        score = int(np.clip(weighted_mean, 0, 100))
        confidence = coverage_confidence(modules, ("hand", "gait", "voice", "face"))

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
            "engine": self.ENGINE,
        }
