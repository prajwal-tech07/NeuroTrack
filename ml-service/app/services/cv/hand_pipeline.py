import numpy as np
from typing import Dict, Any, Tuple, List, Optional
from app.schemas.features import HandFeatures


class HandPipeline:
    """
    Feature Extraction and Preprocessing Pipeline for Hand Movement & Tremor.
    Biomarkers targeted:
      - Bradykinesia (slowed finger tapping < 4 Hz)
      - Amplitude Decrement / Sequence Effect (MDS-UPDRS Item 3.4)
      - Rest Tremor (4 - 6 Hz peak frequency with dominant power ratio)
      - Postural Steadiness / Drift
    """

    FEATURE_NAMES = [
        "tap_frequency_hz",
        "tap_amplitude_mean",
        "tap_amplitude_decay",
        "tap_interval_cv",
        "tap_hesitations",
        "tremor_peak_hz",
        "tremor_power_ratio",
        "tremor_in_parkinson_band",  # Binary indicator 3.5 - 6.5 Hz
        "hold_drift_px",
        "hold_jitter",
    ]

    @staticmethod
    def extract_feature_vector(features: Dict[str, Any]) -> np.ndarray:
        """
        Extracts structured tabular feature vector for ML classifiers (SVM/RF).
        """
        tap_freq = float(features.get("tapFrequencyHz") or 0.0)
        tap_amp = float(features.get("tapAmplitudeMean") or 0.0)
        tap_decay = float(features.get("tapAmplitudeDecay") or 0.0)
        tap_cv = float(features.get("tapIntervalCv") or 0.0)
        tap_hes = float(features.get("tapHesitations") or 0.0)
        
        tremor_hz = float(features.get("tremorPeakHz") or 0.0)
        tremor_power = float(features.get("tremorPowerRatio") or 0.0)
        
        # 1.0 if tremor peak falls in 3.5 - 6.5 Hz parkinsonian rest tremor band, else 0.0
        in_band = 1.0 if (3.5 <= tremor_hz <= 6.5 and tremor_power > 0.08) else 0.0
        
        hold_drift = float(features.get("holdDriftPx") or 0.0)
        hold_jitter = float(features.get("holdJitter") or 0.0)

        return np.array([
            tap_freq,
            tap_amp,
            tap_decay,
            tap_cv,
            tap_hes,
            tremor_hz,
            tremor_power,
            in_band,
            hold_drift,
            hold_jitter,
        ], dtype=np.float32)

    @staticmethod
    def extract_timeseries_tensor(
        tap_distances: Optional[List[float]],
        target_len: int = 150
    ) -> np.ndarray:
        """
        Prepares resampled fixed-length 1D time-series array for 1D CNN / BiLSTM models.
        """
        if not tap_distances or len(tap_distances) < 10:
            return np.zeros((1, target_len), dtype=np.float32)

        arr = np.array(tap_distances, dtype=np.float32)
        # Resample onto target_len
        orig_indices = np.linspace(0, 1, len(arr))
        target_indices = np.linspace(0, 1, target_len)
        resampled = np.interp(target_indices, orig_indices, arr)
        
        # Standardize (Z-score normalize)
        mean_val = np.mean(resampled)
        std_val = np.std(resampled) + 1e-6
        normalized = (resampled - mean_val) / std_val
        
        return normalized.reshape(1, target_len).astype(np.float32)

    @staticmethod
    def compute_rule_score(features: Dict[str, Any]) -> Tuple[int, List[str], List[Dict[str, Any]]]:
        """
        Calculates heuristic clinical score (0-100) and indicators.
        """
        tap_freq = float(features.get("tapFrequencyHz") or 0.0)
        tap_amp = float(features.get("tapAmplitudeMean") or 0.0)
        tap_decay = float(features.get("tapAmplitudeDecay") or 0.0)
        tap_cv = float(features.get("tapIntervalCv") or 0.0)
        tap_hes = float(features.get("tapHesitations") or 0.0)
        tremor_hz = float(features.get("tremorPeakHz") or 0.0)
        tremor_power = float(features.get("tremorPowerRatio") or 0.0)
        hold_drift = float(features.get("holdDriftPx") or 0.0)

        # Higher is better
        def score_higher(v, good, bad):
            if v >= good: return 100
            if v <= bad: return 0
            return max(0, min(100, (v - bad) / (good - bad) * 100))

        # Lower is better
        def score_lower(v, good, bad):
            if v <= good: return 100
            if v >= bad: return 0
            return max(0, min(100, (bad - v) / (bad - good) * 100))

        s_freq = score_higher(tap_freq, 4.0, 1.2)
        s_amp = score_higher(tap_amp, 0.3, 0.07)
        s_decay = score_lower(tap_decay, 0.12, 0.55)
        s_cv = score_lower(tap_cv, 0.18, 0.6)
        s_hes = score_lower(tap_hes, 0, 6)
        s_drift = score_lower(hold_drift, 0.02, 0.12)
        s_power = score_lower(tremor_power, 0.12, 0.55)

        if 3.5 <= tremor_hz <= 6.5:
            s_band = score_lower(tremor_power, 0.08, 0.4)
        else:
            s_band = 100

        weights = [
            (s_freq, 0.18),
            (s_amp, 0.14),
            (s_decay, 0.14),
            (s_cv, 0.14),
            (s_band, 0.16),
            (s_power, 0.10),
            (s_drift, 0.08),
            (s_hes, 0.06),
        ]
        weighted_score = sum(s * w for s, w in weights)

        flags = []
        if s_band < 55:
            flags.append("hand_rest_tremor_band")
        if s_decay < 45:
            flags.append("hand_amplitude_decrement")
        if s_freq < 45:
            flags.append("hand_bradykinesia")

        def status_for(s):
            if s >= 75: return "normal"
            if s >= 55: return "borderline"
            return "atypical"

        indicators = [
            {"key": "tapFrequency", "label": "Tap frequency", "value": round(tap_freq, 2), "unit": "Hz", "score": int(s_freq), "status": status_for(s_freq), "normal": ">= 4 taps/s", "note": "Bradykinesia shows up as slowed repetitive movement."},
            {"key": "tapAmplitude", "label": "Tap amplitude", "value": round(tap_amp, 2), "unit": "", "score": int(s_amp), "status": status_for(s_amp), "normal": "> 0.30", "note": "Separation amplitude of thumb and index finger."},
            {"key": "decrement", "label": "Amplitude decrement", "value": round(tap_decay, 2), "unit": "", "score": int(s_decay), "status": status_for(s_decay), "normal": "< 0.12", "note": "Shrinkage of tap amplitude over the trial."},
            {"key": "tremorFrequency", "label": "Dominant tremor frequency", "value": round(tremor_hz, 2), "unit": "Hz", "score": int(s_band), "status": status_for(s_band), "normal": "outside 3.5 - 6.5 Hz", "note": "Parkinsonian rest tremor resides characteristically in the 4-6 Hz band."},
        ]

        return int(np.clip(weighted_score, 0, 100)), flags, indicators
