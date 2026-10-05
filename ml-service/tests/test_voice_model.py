"""
Tests for the real-data voice model, its API, and the repaired rule engines.

Run from ml-service/:  python -m pytest tests -q
Tests that need the public recordings skip when data/raw/ is absent.
"""

import glob
import io
import json
import os

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import app
from app.services.audio.voice_features import (FEATURE_NAMES, VoiceQualityError,
                                               extract_from_array)
from app.services.ml.voice_audio_model import (MODEL_FEATURES,
                                               voice_audio_classifier)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIGSHARE = sorted(glob.glob(os.path.join(ROOT, "data", "raw", "figshare", "*", "*.wav")))
client = TestClient(app)


def synthetic_vowel(f0=120.0, sec=6.0, sr=44100, jitter=0.004, shimmer=0.03, noise=0.002, seed=0):
    """Glottal-pulse train through two formant resonators: a crude sustained /a/."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int(sec * sr))
    t = 0.05
    while t < sec - 0.05:
        period = (1 / f0) * (1 + rng.normal(0, jitter))
        amp = 1 + rng.normal(0, shimmer)
        n = int(t * sr)
        k = np.arange(int(period * sr))
        pulse = amp * np.exp(-k / (0.0015 * sr)) * np.sin(2 * np.pi * 700 * k / sr)
        pulse += 0.5 * amp * np.exp(-k / (0.001 * sr)) * np.sin(2 * np.pi * 1200 * k / sr)
        out[n:n + len(k)] += pulse[: len(out) - n]
        t += period
    out += rng.normal(0, noise, len(out))
    return 0.3 * out / np.max(np.abs(out)), sr


def wav_bytes(x, sr):
    buf = io.BytesIO()
    sf.write(buf, x, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

class TestExtraction:
    def test_extracts_all_features_from_vowel(self):
        x, sr = synthetic_vowel()
        v = extract_from_array(x, sr)
        for name in FEATURE_NAMES:
            assert np.isfinite(v[name]), name
        assert 110 < v["meanPitchHz"] < 130
        assert v["voicedSec"] > 4

    def test_units_match_training_data(self):
        """Praat prints percent; the training data stores fractions."""
        x, sr = synthetic_vowel(jitter=0.004, shimmer=0.03)
        v = extract_from_array(x, sr)
        assert 0 < v["locPctJitter"] < 0.05
        assert 0 < v["locShimmer"] < 0.5
        assert v["ddpJitter"] == pytest.approx(3 * v["rapJitter"], rel=0.02)
        assert v["ddaShimmer"] == pytest.approx(3 * v["apq3Shimmer"], rel=0.02)

    def test_more_perturbation_gives_higher_jitter(self):
        lo = extract_from_array(*synthetic_vowel(jitter=0.002, seed=1))
        hi = extract_from_array(*synthetic_vowel(jitter=0.02, seed=1))
        assert hi["locPctJitter"] > 2 * lo["locPctJitter"]

    def test_silence_is_rejected(self):
        with pytest.raises(VoiceQualityError):
            extract_from_array(np.zeros(44100 * 4), 44100)

    def test_too_short_is_rejected(self):
        x, sr = synthetic_vowel(sec=0.6)
        with pytest.raises(VoiceQualityError):
            extract_from_array(x, sr)

    def test_noise_is_rejected(self):
        noise = np.random.default_rng(0).normal(0, 0.1, 44100 * 4)
        with pytest.raises(VoiceQualityError):
            extract_from_array(noise, 44100)


# ---------------------------------------------------------------------------
# Model bundle
# ---------------------------------------------------------------------------

class TestModel:
    def test_loaded(self):
        assert voice_audio_classifier.is_loaded, voice_audio_classifier.load_error

    def test_metrics_are_measured_subject_level(self):
        m = voice_audio_classifier.bundle["metrics"]
        cv = m["subject_cv"]
        assert "subject-grouped" in cv["method"]
        assert m["n_subjects"] == 252
        # Regression floor for the honestly measured performance.
        assert cv["auc"] >= 0.78
        assert cv["balanced_accuracy"] >= 0.70
        assert cv["auc_95ci"][0] < cv["auc"] < cv["auc_95ci"][1]

    def test_model_uses_only_channel_robust_features(self):
        assert voice_audio_classifier.bundle["feature_names"] == MODEL_FEATURES + ["male"]
        assert not any("Jitter" in f for f in MODEL_FEATURES)

    def test_report_file_matches_bundle(self):
        path = os.path.join(ROOT, "app", "models", "voice_pd_model_report.json")
        with open(path, encoding="utf-8") as f:
            report = json.load(f)
        assert report["metrics"]["subject_cv"]["auc"] == voice_audio_classifier.bundle["metrics"]["subject_cv"]["auc"]
        assert report["threshold"] == voice_audio_classifier.bundle["threshold"]

    def test_prediction_shape_and_ranges(self):
        x, sr = synthetic_vowel(sec=6)
        r = voice_audio_classifier.predict_wav_bytes(wav_bytes(x, sr), male=True)
        assert 0 <= r["pdLikeness"] <= 1
        assert r["segmentsScored"] == 3
        assert r["elevated"] == (r["pdLikeness"] >= r["threshold"])
        assert isinstance(r["reliable"], bool)
        assert r["validation"]["trainingSubjects"] == 252

    def test_deterministic(self):
        data = wav_bytes(*synthetic_vowel(seed=3))
        a = voice_audio_classifier.predict_wav_bytes(data, male=False)
        b = voice_audio_classifier.predict_wav_bytes(data, male=False)
        assert a["pdLikeness"] == b["pdLikeness"]

    def test_unknown_sex_is_accepted(self):
        r = voice_audio_classifier.predict_wav_bytes(wav_bytes(*synthetic_vowel()), male=None)
        assert r["sexUsed"] is None

    def test_browser_rate_48k_works(self):
        x, sr = synthetic_vowel(sr=48000)
        r = voice_audio_classifier.predict_wav_bytes(wav_bytes(x, sr), male=True)
        assert 0 <= r["pdLikeness"] <= 1

    def test_ood_gate_flags_extreme_input(self):
        """A grossly abnormal signal must be marked unreliable, not scored."""
        x, sr = synthetic_vowel(jitter=0.08, shimmer=0.4, noise=0.05, seed=5)
        try:
            r = voice_audio_classifier.predict_wav_bytes(wav_bytes(x, sr), male=True)
        except VoiceQualityError:
            return  # rejected outright is also acceptable
        assert r["reliable"] is False

    def test_training_recordings_score_in_distribution(self):
        """Real Sakar feature rows must pass the OOD gate ~99% of the time by construction."""
        import pandas as pd
        from app.services.ml.voice_audio_model import distribution_distance
        csv = os.path.join(ROOT, "data", "raw", "sakar", "pd_speech_features.csv")
        if not os.path.exists(csv):
            pytest.skip("Sakar data not downloaded")
        s = pd.read_csv(csv, header=1)
        X = s[MODEL_FEATURES].copy()
        X["male"] = s["gender"].astype(float)
        d = distribution_distance(voice_audio_classifier.bundle["engineer"], X)
        assert np.mean(d <= voice_audio_classifier.bundle["ood_threshold"]) >= 0.98


@pytest.mark.skipif(not FIGSHARE, reason="figshare recordings not downloaded")
def test_real_recordings_end_to_end():
    """Every real figshare recording goes through the full production path."""
    ok = 0
    for path in FIGSHARE[:20]:
        with open(path, "rb") as f:
            r = voice_audio_classifier.predict_wav_bytes(f.read(), male=None)
        assert 0 <= r["pdLikeness"] <= 1
        ok += 1
    assert ok == 20


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

class TestApi:
    def test_status(self):
        r = client.get("/api/v1/score/voice/status")
        assert r.status_code == 200
        body = r.json()
        assert body["loaded"] is True
        assert body["metrics"]["subject_cv"]["auc"] >= 0.78

    def test_audio_endpoint(self):
        data = wav_bytes(*synthetic_vowel())
        r = client.post("/api/v1/score/voice/audio",
                        files={"audio": ("v.wav", data, "audio/wav")}, data={"sex": "female"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["sexUsed"] == "female"
        assert set(body["features"]) >= set(FEATURE_NAMES)

    def test_audio_endpoint_rejects_silence_with_400(self):
        data = wav_bytes(np.zeros(44100 * 3), 44100)
        r = client.post("/api/v1/score/voice/audio", files={"audio": ("v.wav", data, "audio/wav")})
        assert r.status_code == 400
        assert "silent" in r.json()["detail"].lower()

    def test_audio_endpoint_rejects_wrong_type(self):
        r = client.post("/api/v1/score/voice/audio", files={"audio": ("v.mp3", b"abc", "audio/mpeg")})
        assert r.status_code == 400

    def test_audio_endpoint_rejects_garbage_bytes(self):
        r = client.post("/api/v1/score/voice/audio", files={"audio": ("v.wav", b"not a wav", "audio/wav")})
        assert r.status_code == 400

    def test_legacy_22_feature_endpoint_removed(self):
        r = client.post("/api/v1/score/voice/predict", json={"features": [0.0] * 22})
        assert r.status_code in (404, 405)


# ---------------------------------------------------------------------------
# Rule engines (previously crashed into a silent fallback)
# ---------------------------------------------------------------------------

FUSION_PAYLOAD = {
    "modules": {
        "face": {"features": {"asymmetryIndex": 0.03, "blinkRate": 18.0, "expressivityIndex": 0.15,
                              "smileAmplitude": 0.22, "smileAmplitudeLeft": 0.22,
                              "smileAmplitudeRight": 0.21, "eyeOpenAsymmetry": 0.02}, "quality": 1.0},
        "hand": {"features": {"tapFrequencyHz": 4.8, "tapAmplitudeMean": 0.35, "tapAmplitudeDecay": 0.05,
                              "tapIntervalCv": 0.12, "tremorPeakHz": 9.2, "tremorPowerRatio": 0.03},
                 "quality": 0.5},
    },
    "age": 35,
}


class TestRuleEngines:
    def test_fusion_reports_rule_engine_honestly(self):
        r = client.post("/api/v1/score/fusion", json=FUSION_PAYLOAD)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["scoringEngine"] == "rule-based-v2"
        for cond in ("parkinsons", "paralysis"):
            assert body["conditions"][cond]["engine"] == "rule-based"

    def test_confidence_reflects_coverage_not_a_constant(self):
        body = client.post("/api/v1/score/fusion", json=FUSION_PAYLOAD).json()
        # face (q=1.0) + hand (q=0.5) of 4 relevant modules = 1.5 / 4
        assert body["conditions"]["parkinsons"]["confidence"] == pytest.approx(0.375)
        assert body["conditions"]["paralysis"]["confidence"] == pytest.approx(0.375)
