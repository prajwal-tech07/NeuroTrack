"""
voice_audio_model.py -- Parkinson's voice model on real recordings
===================================================================

Scores a sustained /a/ recording with a model trained on real patients:
the Sakar et al. (2018) dataset, 252 subjects (188 PD, 64 healthy), whose
features were produced by Praat -- the same engine voice_features.py uses.

Training and evaluation: scripts/train_voice_model.py. The bundle stores the
honestly measured, subject-level cross-validated metrics, which are what the
API reports -- never a hand-typed number.

The output is a *voice PD-likeness* score under equal class priors. It is not
the probability that the user has Parkinson's: real-world prevalence is far
lower than in the training cohort, and voice alone is a weak marker.
"""

import io
import os
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

from app.core.config import settings
from app.core.logging import logger
from app.services.audio.voice_features import (
    FEATURE_NAMES,
    VoiceQualityError,
    extract_from_sound,
)

MODEL_FILENAME = "voice_pd_model.joblib"

# Features the model uses. Jitter, period SD and NHR are measured and shown to
# the user but left out of the model: they shift 2-14x between microphones and
# codecs (measured against the 8 kHz figshare recordings), and dropping them did
# not lower subject-level CV AUC on the training cohort.
_CHANNEL_SENSITIVE = {
    "locPctJitter", "locAbsJitter", "rapJitter", "ppq5Jitter", "ddpJitter",
    "stdDevPeriodPulses", "meanNoiseToHarmHarmonicity",
}
MODEL_FEATURES = [f for f in FEATURE_NAMES if f not in _CHANNEL_SENSITIVE]

# Measures that are already on a linear, roughly normal scale; the rest are
# positive, heavily right-skewed ratios and are log-transformed.
_LINEAR = {"meanAutoCorrHarmonicity", "meanHarmToNoiseHarmonicity", "f1", "f2", "f3", "f4"}

# Segment averaging: the training cohort gave 3 recordings per subject, so a
# long enough take is split into 3 parts and their scores averaged.
N_SEGMENTS = 3
MIN_SEGMENT_SEC = 1.5


class VoiceFeatureEngineer(BaseEstimator, TransformerMixin):
    """
    Raw voice-report features (+ male flag) -> model features.

    - log-transforms skewed perturbation measures
    - adds scale-free ratios (apq11/apq3 shimmer, logit autocorrelation)
    - z-scores every feature against the training data *of the same sex*,
      because F0, formants and perturbation norms differ strongly by sex.
    """

    def fit(self, X: pd.DataFrame, y=None):
        E = self._engineer(X)
        male = X["male"].to_numpy()
        self.columns_ = list(E.columns)
        self.stats_ = {}
        for sex in (0.0, 1.0):
            part = E[male == sex]
            if len(part) < 5:
                part = E
            self.stats_[sex] = (part.mean().to_numpy(), part.std().to_numpy() + 1e-9)
        # Unknown sex (0.5): average of both groups.
        self.stats_[0.5] = tuple((a + b) / 2 for a, b in zip(self.stats_[0.0], self.stats_[1.0]))
        return self

    def transform(self, X: pd.DataFrame) -> np.ndarray:
        E = self._engineer(X).to_numpy(dtype=np.float64)
        male = X["male"].to_numpy()
        out = np.empty_like(E)
        for i, sex in enumerate(male):
            mu, sd = self.stats_.get(float(sex), self.stats_[0.5])
            out[i] = (E[i] - mu) / sd
        return np.column_stack([out, male])

    @staticmethod
    def _engineer(X: pd.DataFrame) -> pd.DataFrame:
        E = pd.DataFrame(index=X.index)
        for c in MODEL_FEATURES:
            v = X[c].astype(float)
            E[c] = v if c in _LINEAR else np.log(v.clip(lower=1e-7))
        E["apq11OverApq3Shimmer"] = X["apq11Shimmer"] / X["apq3Shimmer"].clip(lower=1e-7)
        ac = X["meanAutoCorrHarmonicity"].clip(1e-4, 0.9999)
        E["logitAutoCorr"] = np.log(ac / (1 - ac))
        return E


def distribution_distance(engineer: VoiceFeatureEngineer, X: pd.DataFrame) -> np.ndarray:
    """
    RMS z-score of each row against the training cohort of the same sex.
    Large values mean the recording does not look like the training data
    (different microphone/codec, noise, not a sustained vowel ...), in which
    case the model's output should not be trusted.
    """
    Z = engineer.transform(X)[:, :-1]  # drop the trailing male flag
    return np.sqrt(np.mean(np.square(Z), axis=1))


def features_frame(rows: List[Dict[str, Any]], male: Optional[bool]) -> pd.DataFrame:
    sex = 0.5 if male is None else float(bool(male))
    df = pd.DataFrame([{n: r[n] for n in MODEL_FEATURES} for r in rows])
    df["male"] = sex
    return df


class VoiceAudioClassifier:
    def __init__(self, model_path: Optional[str] = None):
        self.path = model_path or os.path.join(settings.MODEL_DIR, MODEL_FILENAME)
        self.bundle: Optional[Dict[str, Any]] = None
        self.load_error: Optional[str] = None
        self._load()

    def _load(self) -> None:
        if not os.path.exists(self.path):
            self.load_error = f"{self.path} not found. Run scripts/train_voice_model.py."
            logger.warning(f"[VoiceAudioClassifier] {self.load_error}")
            return
        try:
            self.bundle = joblib.load(self.path)
            m = self.bundle["metrics"]["subject_cv"]
            logger.info(
                f"[VoiceAudioClassifier] Loaded {self.bundle['engine']} "
                f"(subject-level CV AUC={m['auc']:.3f}, balanced acc={m['balanced_accuracy']:.3f})"
            )
        except Exception as exc:  # corrupt / incompatible file
            self.load_error = f"Failed to load {self.path}: {exc}"
            logger.error(f"[VoiceAudioClassifier] {self.load_error}")

    @property
    def is_loaded(self) -> bool:
        return self.bundle is not None

    def _segments(self, sound) -> list:
        """Split the take into N_SEGMENTS parts when it is long enough."""
        if sound.duration < N_SEGMENTS * MIN_SEGMENT_SEC:
            return [sound]
        step = sound.duration / N_SEGMENTS
        return [
            sound.extract_part(from_time=sound.xmin + i * step, to_time=sound.xmin + (i + 1) * step,
                               preserve_times=False)
            for i in range(N_SEGMENTS)
        ]

    def score_rows(self, rows: List[Dict[str, Any]], male: Optional[bool]) -> float:
        """Calibrated PD-likeness (equal priors) averaged over feature rows."""
        X = features_frame(rows, male)
        raw = self.bundle["pipeline"].predict_proba(X)[:, 1]
        return float(np.mean(self._calibrate(raw)))

    def _calibrate(self, p: np.ndarray) -> np.ndarray:
        a, b = self.bundle["calibration"]
        p = np.clip(p, 1e-6, 1 - 1e-6)
        z = a * np.log(p / (1 - p)) + b
        return 1.0 / (1.0 + np.exp(-z))

    def predict_sound(self, sound, male: Optional[bool]) -> Dict[str, Any]:
        if not self.is_loaded:
            raise RuntimeError(self.load_error or "Voice model not loaded")

        whole = extract_from_sound(sound)  # raises VoiceQualityError on unusable audio
        rows = []
        for seg in self._segments(sound):
            try:
                rows.append(extract_from_sound(seg))
            except VoiceQualityError:
                continue
        if not rows:
            rows = [whole]

        score = self.score_rows(rows, male)
        distance = float(np.mean(distribution_distance(self.bundle["engineer"], features_frame(rows, male))))
        in_distribution = distance <= self.bundle["ood_threshold"]
        threshold = self.bundle["threshold"]
        metrics = self.bundle["metrics"]
        return {
            "pdLikeness": round(score, 4),
            "threshold": threshold,
            "elevated": bool(score >= threshold),
            # When False the recording is unlike anything the model was trained
            # on, so callers must not use pdLikeness.
            "reliable": bool(in_distribution),
            "distributionDistance": round(distance, 3),
            "distributionThreshold": self.bundle["ood_threshold"],
            "segmentsScored": len(rows),
            "sexUsed": None if male is None else ("male" if male else "female"),
            "features": {k: whole[k] for k in FEATURE_NAMES + ["meanPitchHz", "voicedSec"]},
            "engine": self.bundle["engine"],
            "validation": {
                "method": metrics["subject_cv"]["method"],
                "auc": metrics["subject_cv"]["auc"],
                "balancedAccuracy": metrics["subject_cv"]["balanced_accuracy"],
                "sensitivity": metrics["subject_cv"]["sensitivity"],
                "specificity": metrics["subject_cv"]["specificity"],
                "trainingSubjects": metrics["n_subjects"],
            },
        }

    def predict_wav_bytes(self, data: bytes, male: Optional[bool]) -> Dict[str, Any]:
        import soundfile as sf
        import parselmouth

        try:
            samples, sr = sf.read(io.BytesIO(data), dtype="float64", always_2d=True)
        except Exception as exc:
            raise VoiceQualityError(f"Could not read the audio file: {exc}") from exc
        mono = samples.mean(axis=1)
        if not np.any(np.abs(mono) > 1e-4):
            raise VoiceQualityError("The recording is silent. Check the microphone is not muted.")
        return self.predict_sound(parselmouth.Sound(mono, sampling_frequency=sr), male)


voice_audio_classifier = VoiceAudioClassifier()
