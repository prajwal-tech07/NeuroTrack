import numpy as np
from typing import Dict, Any, Tuple, List, Optional


class GaitPipeline:
    """
    Feature Extraction and Preprocessing Pipeline for Gait & Posture Kinematics.
    Biomarkers targeted:
      - Parkinson's: Reduced Arm Swing, Shuffling Cadence, Increased Step Variability, Forward Trunk Lean
      - Hemiparesis / Paralysis: Severe Step Duration Asymmetry, Excessive Double Support Ratio
    """

    FEATURE_NAMES = [
        "cadence_steps_min",
        "step_time_cv",
        "step_symmetry_ratio",
        "arm_swing_amplitude",
        "arm_swing_asymmetry",
        "trunk_sway_index",
        "postural_lean_deg",
        "double_support_ratio",
    ]

    @staticmethod
    def extract_feature_vector(features: Dict[str, Any]) -> np.ndarray:
        """
        Extracts structured feature vector for ML models (SVM/RF).
        """
        cadence = float(features.get("cadenceStepsMin") or 0.0)
        step_cv = float(features.get("stepTimeCv") or 0.0)
        step_sym = float(features.get("stepSymmetry") or 0.0)
        arm_amp = float(features.get("armSwingAmplitude") or 0.0)
        arm_asym = float(features.get("armSwingAsymmetry") or 0.0)
        sway = float(features.get("trunkSwayIndex") or 0.0)
        lean = float(features.get("posturalLeanDeg") or 0.0)
        double_supp = float(features.get("doubleSupportRatio") or 0.0)

        return np.array([
            cadence,
            step_cv,
            step_sym,
            arm_amp,
            arm_asym,
            sway,
            lean,
            double_supp,
        ], dtype=np.float32)

    @staticmethod
    def compute_rule_score(features: Dict[str, Any]) -> Tuple[int, List[str], List[Dict[str, Any]]]:
        """
        Calculates heuristic clinical score (0-100) and indicators.
        """
        cadence = float(features.get("cadenceStepsMin") or 0.0)
        step_cv = float(features.get("stepTimeCv") or 0.0)
        step_sym = float(features.get("stepSymmetry") or 0.0)
        arm_amp = float(features.get("armSwingAmplitude") or 0.0)
        arm_asym = float(features.get("armSwingAsymmetry") or 0.0)
        sway = float(features.get("trunkSwayIndex") or 0.0)
        lean = float(features.get("posturalLeanDeg") or 0.0)
        double_supp = float(features.get("doubleSupportRatio") or 0.0)

        def score_higher(v, good, bad):
            if v >= good: return 100
            if v <= bad: return 0
            return max(0, min(100, (v - bad) / (good - bad) * 100))

        def score_lower(v, good, bad):
            if v <= good: return 100
            if v >= bad: return 0
            return max(0, min(100, (bad - v) / (bad - good) * 100))

        def score_in_range(v, g_lo, g_hi, b_lo, b_hi):
            if g_lo <= v <= g_hi: return 100
            if v < g_lo: return score_higher(v, g_lo, b_lo)
            return score_lower(v, g_hi, b_hi)

        s_cad = score_in_range(cadence, 100, 125, 55, 165)
        s_cv = score_lower(step_cv, 0.04, 0.16)
        s_sym = score_lower(step_sym, 0.05, 0.25)
        s_arm = score_higher(arm_amp, 0.12, 0.02)
        s_arm_asym = score_lower(arm_asym, 0.15, 0.60)
        s_sway = score_lower(sway, 0.03, 0.14)
        s_lean = score_lower(lean, 8, 28)
        s_supp = score_lower(double_supp, 0.26, 0.45)

        weights = [
            (s_cad, 0.18),
            (s_cv, 0.18),
            (s_arm, 0.16),
            (s_sym, 0.12),
            (s_arm_asym, 0.12),
            (s_sway, 0.10),
            (s_lean, 0.08),
            (s_supp, 0.06),
        ]
        weighted_score = sum(s * w for s, w in weights)

        flags = []
        if s_arm < 45:
            flags.append("gait_reduced_arm_swing")
        if s_cv < 45:
            flags.append("gait_high_variability")
        if s_cad < 45:
            flags.append("gait_cadence_atypical")
        if s_sym < 45 or s_supp < 45:
            flags.append("gait_asymmetry_severe")

        def status_for(s):
            if s >= 75: return "normal"
            if s >= 55: return "borderline"
            return "atypical"

        indicators = [
            {"key": "cadence", "label": "Cadence", "value": round(cadence, 1), "unit": "steps/min", "score": int(s_cad), "status": status_for(s_cad), "normal": "100 - 125 /min", "note": "Step frequency (rhythm)."},
            {"key": "armSwing", "label": "Arm swing amplitude", "value": round(arm_amp, 3), "unit": "", "score": int(s_arm), "status": status_for(s_arm), "normal": "> 0.12", "note": "Reduced arm swing is an early parkinsonian marker."},
            {"key": "symmetry", "label": "Step symmetry", "value": round(step_sym, 3), "unit": "", "score": int(s_sym), "status": status_for(s_sym), "normal": "< 0.05", "note": "Left/right step timing disparity."},
            {"key": "doubleSupport", "label": "Double support ratio", "value": round(double_supp, 3), "unit": "", "score": int(s_supp), "status": status_for(s_supp), "normal": "< 0.26", "note": "Share of gait cycle with both feet grounded (elevated in hemiparesis)."},
        ]

        return int(np.clip(weighted_score, 0, 100)), flags, indicators
