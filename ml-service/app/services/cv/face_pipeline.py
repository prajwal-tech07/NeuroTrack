import numpy as np
from typing import Dict, Any, Tuple, List


class FacePipeline:
    """
    Feature Extraction and Preprocessing Pipeline for Facial Analysis.
    Biomarkers targeted:
      - Stroke / Bell's Palsy: Left/Right Facial Asymmetry, Mouth Corner Droop, Eyelid Aperture Mismatch
      - Parkinson's Hypomimia: Reduced Expressivity Index, Reduced Blink Rate (< 12/min)
    """

    FEATURE_NAMES = [
        "asymmetry_index",
        "eye_open_asymmetry",
        "smile_laterality_ratio",
        "brow_laterality_ratio",
        "expressivity_index",
        "blink_rate",
        "smile_amplitude_mean",
        "mouth_open_range",
        "eye_aperture_left",
        "eye_aperture_right",
    ]

    @staticmethod
    def extract_feature_vector(features: Dict[str, Any]) -> np.ndarray:
        """
        Extracts structured feature vector for ML models (SVM/RF).
        Computes lateral differential ratios.
        """
        asymmetry_idx = float(features.get("asymmetryIndex") or 0.0)
        eye_open_asym = float(features.get("eyeOpenAsymmetry") or 0.0)
        
        smile_l = float(features.get("smileAmplitudeLeft") or features.get("smileAmplitude") or 0.0)
        smile_r = float(features.get("smileAmplitudeRight") or features.get("smileAmplitude") or 0.0)
        smile_max = max(smile_l, smile_r, 1e-4)
        smile_laterality = abs(smile_l - smile_r) / smile_max

        brow_l = float(features.get("browRaiseLeft") or features.get("browRaiseAmplitude") or 0.0)
        brow_r = float(features.get("browRaiseRight") or features.get("browRaiseAmplitude") or 0.0)
        brow_max = max(brow_l, brow_r, 1e-4)
        brow_laterality = abs(brow_l - brow_r) / brow_max

        expressivity = float(features.get("expressivityIndex") or 0.0)
        blink_rate = float(features.get("blinkRate") or 0.0)
        smile_amp = float(features.get("smileAmplitude") or 0.0)
        mouth_open = float(features.get("mouthOpenRange") or 0.0)
        eye_l = float(features.get("eyeApertureLeft") or 0.0)
        eye_r = float(features.get("eyeApertureRight") or 0.0)

        return np.array([
            asymmetry_idx,
            eye_open_asym,
            smile_laterality,
            brow_laterality,
            expressivity,
            blink_rate,
            smile_amp,
            mouth_open,
            eye_l,
            eye_r,
        ], dtype=np.float32)

    @staticmethod
    def compute_rule_score(features: Dict[str, Any]) -> Tuple[int, List[str], List[Dict[str, Any]]]:
        """
        Calculates heuristic clinical score (0-100) and indicators.
        """
        blink_rate = float(features.get("blinkRate") or 0.0)
        expressivity = float(features.get("expressivityIndex") or 0.0)
        smile_amp = float(features.get("smileAmplitude") or 0.0)
        brow_amp = float(features.get("browRaiseAmplitude") or 0.0)
        asymmetry = float(features.get("asymmetryIndex") or 0.0)
        mouth_open = float(features.get("mouthOpenRange") or 0.0)
        eye_asym = float(features.get("eyeOpenAsymmetry") or 0.0)

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

        s_blink = score_in_range(blink_rate, 12, 25, 3, 42)
        s_expr = score_higher(expressivity, 0.12, 0.02)
        s_smile = score_higher(smile_amp, 0.18, 0.03)
        s_brow = score_higher(brow_amp, 0.10, 0.015)
        s_sym = score_lower(asymmetry, 0.05, 0.22)
        s_jaw = score_higher(mouth_open, 0.12, 0.02)
        s_eye = score_lower(eye_asym, 0.06, 0.25)

        weights = [
            (s_expr, 0.24),
            (s_blink, 0.18),
            (s_smile, 0.16),
            (s_sym, 0.16),
            (s_brow, 0.12),
            (s_jaw, 0.08),
            (s_eye, 0.06),
        ]
        weighted_score = sum(s * w for s, w in weights)

        flags = []
        if s_expr < 45:
            flags.append("face_reduced_expressivity")
        if s_blink < 45:
            flags.append("face_blink_rate_atypical")
        if s_sym < 45 or s_eye < 45:
            flags.append("face_asymmetry")

        def status_for(s):
            if s >= 75: return "normal"
            if s >= 55: return "borderline"
            return "atypical"

        indicators = [
            {"key": "expressivity", "label": "Facial expressivity", "value": round(expressivity, 3), "unit": "", "score": int(s_expr), "status": status_for(s_expr), "normal": "> 0.12", "note": "Overall mobility across facial muscle groups (hypomimia screening)."},
            {"key": "blinkRate", "label": "Blink rate", "value": round(blink_rate, 1), "unit": "/min", "score": int(s_blink), "status": status_for(s_blink), "normal": "12 - 25 /min", "note": "Spontaneous blink frequency."},
            {"key": "symmetry", "label": "Facial symmetry", "value": round(asymmetry, 3), "unit": "", "score": int(s_sym), "status": status_for(s_sym), "normal": "< 0.05", "note": "Left/right facial muscle displacement mismatch (stroke/palsy screening)."},
            {"key": "eyeSymmetry", "label": "Eye aperture symmetry", "value": round(eye_asym, 3), "unit": "", "score": int(s_eye), "status": status_for(s_eye), "normal": "< 0.06", "note": "Discrepancy in left vs right palpebral fissure opening."},
        ]

        return int(np.clip(weighted_score, 0, 100)), flags, indicators
