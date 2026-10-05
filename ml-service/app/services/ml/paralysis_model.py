import numpy as np
from typing import Dict, Any, Tuple, List, Optional
from app.services.ml.confidence import coverage_confidence
from app.services.cv.hand_pipeline import HandPipeline
from app.services.cv.face_pipeline import FacePipeline
from app.services.cv.gait_pipeline import GaitPipeline
from app.services.cv.voice_pipeline import VoicePipeline


class ParalysisClassifier:
    """
    Rule-based Stroke / Facial Palsy / Hemiparesis screening engine.
    Focuses on:
      - Facial Asymmetry & Unilateral Droop (Mouth corner & Eyelid Aperture differential)
      - Hemiparetic Gait Discrepancies (Severe Step Asymmetry & High Double Support)
      - Unilateral Motor Weakness
      - Dysarthric Speech Characteristics
    """

    # Transparent rule-based engine. The model this used to load was trained on
    # synthetic data and reported a hand-typed accuracy of 0.95.
    ENGINE = "rule-based"

    def predict(self, modules: Dict[str, Any], age: Optional[int] = None) -> Dict[str, Any]:
        face_m = modules.get("face")
        gait_m = modules.get("gait")
        hand_m = modules.get("hand")
        voice_m = modules.get("voice")

        flags: List[str] = []
        contributing_factors: List[str] = []
        biomarkers: Dict[str, Any] = {}

        sub_scores = []
        weights = []

        # 1. Face asymmetry is the single most critical stroke/palsy biomarker (weight: 0.45)
        if face_m and face_m.get("completed", True):
            f_feat = face_m.get("features", {})
            f_score, f_flags, _ = FacePipeline.compute_rule_score(f_feat)
            q = face_m.get("quality", 1.0)
            
            # Additional targeted check for unilateral droop
            asym_idx = float(f_feat.get("asymmetryIndex") or 0.0)
            eye_asym = float(f_feat.get("eyeOpenAsymmetry") or 0.0)
            smile_l = float(f_feat.get("smileAmplitudeLeft") or f_feat.get("smileAmplitude") or 0.0)
            smile_r = float(f_feat.get("smileAmplitudeRight") or f_feat.get("smileAmplitude") or 0.0)
            smile_diff = abs(smile_l - smile_r) / max(smile_l, smile_r, 1e-4)

            # Specific stroke score tuning
            if asym_idx > 0.15 or eye_asym > 0.15 or smile_diff > 0.25:
                f_flags.append("stroke_facial_asymmetry_detected")
                contributing_factors.append("Prominent unilateral facial asymmetry / droop detected")
                f_score = min(f_score, 45)

            sub_scores.append(f_score)
            weights.append(0.45 * (0.6 + 0.4 * q))
            flags.extend(f_flags)
            biomarkers["faceAsymmetryScore"] = f_score
            biomarkers["facialAsymmetryIndex"] = asym_idx
            biomarkers["smileLateralityDiff"] = smile_diff

        # 2. Gait Hemiparesis (weight: 0.30)
        if gait_m and gait_m.get("completed", True):
            g_feat = gait_m.get("features", {})
            g_score, g_flags, _ = GaitPipeline.compute_rule_score(g_feat)
            q = gait_m.get("quality", 1.0)

            step_sym = float(g_feat.get("stepSymmetry") or 0.0)
            double_supp = float(g_feat.get("doubleSupportRatio") or 0.0)
            if step_sym > 0.18 or double_supp > 0.38:
                g_flags.append("stroke_hemiparetic_gait_pattern")
                contributing_factors.append("Severe step time asymmetry / prolonged double-support gait phase")
                g_score = min(g_score, 50)

            sub_scores.append(g_score)
            weights.append(0.30 * (0.6 + 0.4 * q))
            flags.extend(g_flags)
            biomarkers["gaitHemiparesisScore"] = g_score
            biomarkers["stepSymmetry"] = step_sym

        # 3. Hand Motor Weakness (weight: 0.15)
        if hand_m and hand_m.get("completed", True):
            h_feat = hand_m.get("features", {})
            h_score, h_flags, _ = HandPipeline.compute_rule_score(h_feat)
            q = hand_m.get("quality", 1.0)
            
            tap_freq = float(h_feat.get("tapFrequencyHz") or 0.0)
            tap_amp = float(h_feat.get("tapAmplitudeMean") or 0.0)
            if tap_freq < 2.0 and tap_amp < 0.15:
                contributing_factors.append("Marked unilateral fine motor weakness / paresis")
                h_flags.append("hand_severe_weakness")
                h_score = min(h_score, 40)

            sub_scores.append(h_score)
            weights.append(0.15 * (0.6 + 0.4 * q))
            flags.extend(h_flags)
            biomarkers["handWeaknessScore"] = h_score

        # 4. Voice Dysarthria (weight: 0.10)
        if voice_m and voice_m.get("completed", True):
            v_feat = voice_m.get("features", {})
            v_score, v_flags, _ = VoicePipeline.compute_rule_score(v_feat, age)
            q = voice_m.get("quality", 1.0)
            
            phon = float(v_feat.get("maxPhonationSec") or 0.0)
            if phon < 6.0:
                contributing_factors.append("Significantly reduced vocal breath support (dysarthria indicator)")

            sub_scores.append(v_score)
            weights.append(0.10 * (0.6 + 0.4 * q))
            flags.extend(v_flags)
            biomarkers["voiceScore"] = v_score

        if not sub_scores:
            return {
                "condition": "paralysis",
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

        # Penalize heavily if acute stroke markers are present
        if "stroke_facial_asymmetry_detected" in flags:
            weighted_mean -= 10.0
        if "stroke_hemiparetic_gait_pattern" in flags:
            weighted_mean -= 6.0

        score = int(np.clip(weighted_mean, 0, 100))
        confidence = coverage_confidence(modules, ("face", "gait", "hand", "voice"))

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
            "condition": "paralysis",
            "score": score,
            "riskLevel": risk_level,
            "riskLabel": risk_label,
            "confidence": confidence,
            "flags": list(set(flags)),
            "contributingFactors": contributing_factors,
            "biomarkers": biomarkers,
            "engine": self.ENGINE,
        }
