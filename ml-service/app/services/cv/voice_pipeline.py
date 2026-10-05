import numpy as np
from typing import Dict, Any, Tuple, List, Optional


class VoicePipeline:
    """
    Feature Extraction and Processing for Acoustic Voice Analysis.
    Biomarkers targeted:
      - Parkinson's Dysphonia: Elevated Jitter & Shimmer, Monotone Pitch (low prosody), Low HNR
      - Dysarthria / Stroke: Reduced Max Phonation Time, Atypical Speech Rate
    """

    FEATURE_NAMES = [
        "jitter_percent",
        "shimmer_percent",
        "hnr_db",
        "f0_std_semitones",
        "pause_ratio",
        "speech_rate_syll",
        "max_phonation_sec",
        "intensity_cv",
    ]

    @staticmethod
    def extract_feature_vector(features: Dict[str, Any]) -> np.ndarray:
        """
        Extracts structured feature vector for ML models (SVM/RF).
        """
        jitter = float(features.get("jitterPercent") or 0.0)
        shimmer = float(features.get("shimmerPercent") or 0.0)
        hnr = float(features.get("hnrDb") or 0.0)
        prosody = float(features.get("f0StdSemitones") or 0.0)
        pauses = float(features.get("pauseRatio") or 0.0)
        rate = float(features.get("speechRateSyll") or 0.0)
        phonation = float(features.get("maxPhonationSec") or 0.0)
        intensity_cv = float(features.get("intensityCv") or 0.0)

        return np.array([
            jitter,
            shimmer,
            hnr,
            prosody,
            pauses,
            rate,
            phonation,
            intensity_cv,
        ], dtype=np.float32)

    @staticmethod
    def compute_rule_score(features: Dict[str, Any], age: Optional[int] = None) -> Tuple[int, List[str], List[Dict[str, Any]]]:
        """
        Calculates heuristic clinical score (0-100) and indicators.
        """
        jitter = float(features.get("jitterPercent") or 0.0)
        shimmer = float(features.get("shimmerPercent") or 0.0)
        hnr = float(features.get("hnrDb") or 0.0)
        prosody = float(features.get("f0StdSemitones") or 0.0)
        pauses = float(features.get("pauseRatio") or 0.0)
        rate = float(features.get("speechRateSyll") or 0.0)
        phonation = float(features.get("maxPhonationSec") or 0.0)
        intensity_cv = float(features.get("intensityCv") or 0.0)

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

        s_jitter = score_lower(jitter, 1.04, 3.2)
        s_shimmer = score_lower(shimmer, 3.81, 10.5)
        s_hnr = score_higher(hnr, 20.0, 7.0)
        s_prosody = score_higher(prosody, 2.4, 0.6)
        s_pauses = score_lower(pauses, 0.22, 0.55)
        s_rate = score_in_range(rate, 3.5, 6.0, 1.6, 8.5)
        s_phon = score_higher(phonation, 12.0, 4.0)
        s_loud = score_lower(intensity_cv, 0.22, 0.60)

        weights = [
            (s_jitter, 0.18),
            (s_shimmer, 0.16),
            (s_hnr, 0.18),
            (s_prosody, 0.16),
            (s_pauses, 0.10),
            (s_rate, 0.08),
            (s_phon, 0.08),
            (s_loud, 0.06),
        ]
        weighted_score = sum(s * w for s, w in weights)

        # Mild age adjustment
        if age and age > 45:
            bonus = min(6.0, ((age - 45) / 10.0) * 1.6)
            if weighted_score < 90:
                weighted_score += bonus

        flags = []
        if s_jitter < 45:
            flags.append("voice_jitter_elevated")
        if s_prosody < 45:
            flags.append("voice_monotone")
        if s_hnr < 45:
            flags.append("voice_breathiness")

        def status_for(s):
            if s >= 75: return "normal"
            if s >= 55: return "borderline"
            return "atypical"

        indicators = [
            {"key": "jitter", "label": "Pitch stability (jitter)", "value": round(jitter, 2), "unit": "%", "score": int(s_jitter), "status": status_for(s_jitter), "normal": "< 1.04%", "note": "Perturbation in fundamental frequency."},
            {"key": "prosody", "label": "Pitch variation (prosody)", "value": round(prosody, 2), "unit": "st", "score": int(s_prosody), "status": status_for(s_prosody), "normal": "> 2.4 semitones", "note": "Monotone speech is an early Parkinson's hallmark."},
            {"key": "hnr", "label": "Harmonics-to-noise ratio", "value": round(hnr, 1), "unit": "dB", "score": int(s_hnr), "status": status_for(s_hnr), "normal": "> 20 dB", "note": "Voice clarity relative to breathiness."},
            {"key": "phonation", "label": "Max phonation time", "value": round(phonation, 1), "unit": "s", "score": int(s_phon), "status": status_for(s_phon), "normal": "> 12 s", "note": "Sustained vowel breath support."},
        ]

        return int(np.clip(weighted_score, 0, 100)), flags, indicators
