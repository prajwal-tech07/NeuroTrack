"""
voice_features.py -- Praat voice-report features from a sustained vowel
=======================================================================

Extracts the Praat "Voice report" measures (pitch-period statistics, jitter,
shimmer, harmonicity) from a recording of a sustained /a/.

These are exactly the "baseline features" published with the Sakar et al.
(2018) Parkinson's speech dataset (UCI #470), which were themselves produced
by Praat. Using the same engine and settings here means the model sees the
same kind of numbers at inference time that it was trained on.

The same function is used by the training script (on the public recordings)
and by the API (on the user's recording), so training and inference can never
drift apart.
"""

import re
from typing import Dict, Any, Optional, Tuple

import numpy as np
import parselmouth
from parselmouth.praat import call

# Praat defaults for adult voices; matches the settings used in the
# Sakar et al. voice-report baseline.
PITCH_FLOOR_HZ = 75.0
PITCH_CEILING_HZ = 600.0
MAX_PERIOD_FACTOR = 1.3
MAX_AMPLITUDE_FACTOR = 1.6
SILENCE_THRESHOLD = 0.03
VOICING_THRESHOLD = 0.45

# Feature order fed to the model. Names follow the Sakar dataset columns.
FEATURE_NAMES = [
    "meanPeriodPulses",
    "stdDevPeriodPulses",
    "locPctJitter",
    "locAbsJitter",
    "rapJitter",
    "ppq5Jitter",
    "ddpJitter",
    "locShimmer",
    "locDbShimmer",
    "apq3Shimmer",
    "apq5Shimmer",
    "apq11Shimmer",
    "ddaShimmer",
    "meanAutoCorrHarmonicity",
    "meanNoiseToHarmHarmonicity",
    "meanHarmToNoiseHarmonicity",
    "f1",
    "f2",
    "f3",
    "f4",
]

# Praat "To Formant (burg)" defaults.
FORMANT_CEILING_HZ = 5500.0
N_FORMANTS = 5

# Recording quality gates. Below these the measures are not trustworthy.
MIN_VOICED_SEC = 1.0
MIN_PERIODS = 80

# Voice report line label -> (feature name, scale to the dataset's units).
# Praat prints percentages; the dataset stores fractions.
_REPORT_FIELDS = {
    r"Number of periods": ("numPeriodsPulses", 1.0),
    r"Mean period": ("meanPeriodPulses", 1.0),
    r"Standard deviation of period": ("stdDevPeriodPulses", 1.0),
    r"Jitter \(local\)": ("locPctJitter", 0.01),
    r"Jitter \(local, absolute\)": ("locAbsJitter", 1.0),
    r"Jitter \(rap\)": ("rapJitter", 0.01),
    r"Jitter \(ppq5\)": ("ppq5Jitter", 0.01),
    r"Jitter \(ddp\)": ("ddpJitter", 0.01),
    r"Shimmer \(local\)": ("locShimmer", 0.01),
    r"Shimmer \(local, dB\)": ("locDbShimmer", 1.0),
    r"Shimmer \(apq3\)": ("apq3Shimmer", 0.01),
    r"Shimmer \(apq5\)": ("apq5Shimmer", 0.01),
    r"Shimmer \(apq11\)": ("apq11Shimmer", 0.01),
    r"Shimmer \(dda\)": ("ddaShimmer", 0.01),
    r"Mean autocorrelation": ("meanAutoCorrHarmonicity", 1.0),
    r"Mean noise-to-harmonics ratio": ("meanNoiseToHarmHarmonicity", 1.0),
    r"Mean harmonics-to-noise ratio": ("meanHarmToNoiseHarmonicity", 1.0),
    r"Mean pitch": ("meanPitchHz", 1.0),
    r"Fraction of locally unvoiced frames": ("unvoicedFraction", 0.01),
}

_NUMBER = r"(-?[\d.]+(?:E[-+]?\d+)?)"


class VoiceQualityError(ValueError):
    """Raised when a recording is too short, silent or unvoiced to measure."""


def _parse_report(report: str) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for line in report.splitlines():
        label, _, rest = line.strip().partition(":")
        for pattern, (name, scale) in _REPORT_FIELDS.items():
            if re.fullmatch(pattern, label.strip()):
                m = re.search(_NUMBER, rest)
                if m:
                    try:
                        out[name] = float(m.group(1)) * scale
                    except ValueError:
                        pass
                break
    return out


def _trim_to_voiced(sound: parselmouth.Sound, pitch) -> parselmouth.Sound:
    """Crop leading/trailing silence so only the phonation is analysed."""
    times = pitch.xs()
    f0 = pitch.selected_array["frequency"]
    voiced = times[f0 > 0]
    if voiced.size == 0:
        return sound
    start = max(sound.xmin, float(voiced[0]) - 0.05)
    end = min(sound.xmax, float(voiced[-1]) + 0.05)
    return sound.extract_part(from_time=start, to_time=end, preserve_times=False)


def extract_from_sound(sound: parselmouth.Sound) -> Dict[str, Any]:
    """
    Runs the Praat voice report on a sustained vowel.

    Returns a dict with every FEATURE_NAMES key plus QC fields
    (voicedSec, numPeriodsPulses, unvoicedFraction, meanPitchHz).
    Raises VoiceQualityError if the recording cannot be measured reliably.
    """
    if sound.n_channels > 1:
        sound = sound.convert_to_mono()
    if sound.duration < MIN_VOICED_SEC:
        raise VoiceQualityError(
            f"Recording is only {sound.duration:.1f}s long; at least {MIN_VOICED_SEC:.0f}s of steady 'Aaah' is needed."
        )

    pitch = call(sound, "To Pitch (cc)", 0, PITCH_FLOOR_HZ, 15, "no",
                 SILENCE_THRESHOLD, VOICING_THRESHOLD, 0.01, 0.35, 0.14, PITCH_CEILING_HZ)
    sound = _trim_to_voiced(sound, pitch)
    pitch = call(sound, "To Pitch (cc)", 0, PITCH_FLOOR_HZ, 15, "no",
                 SILENCE_THRESHOLD, VOICING_THRESHOLD, 0.01, 0.35, 0.14, PITCH_CEILING_HZ)

    f0 = pitch.selected_array["frequency"]
    voiced_sec = float(np.count_nonzero(f0 > 0) * pitch.time_step)
    if voiced_sec < MIN_VOICED_SEC:
        raise VoiceQualityError(
            f"Only {voiced_sec:.1f}s of voicing was detected; hold a steady 'Aaah' for longer, closer to the microphone."
        )

    points = call([sound, pitch], "To PointProcess (cc)")
    report = call([sound, pitch, points], "Voice report", 0, 0,
                  PITCH_FLOOR_HZ, PITCH_CEILING_HZ, MAX_PERIOD_FACTOR,
                  MAX_AMPLITUDE_FACTOR, SILENCE_THRESHOLD, VOICING_THRESHOLD)
    values = _parse_report(report)

    if values.get("numPeriodsPulses", 0) < MIN_PERIODS:
        raise VoiceQualityError("Too few stable voice cycles were found; try a longer, steadier 'Aaah'.")

    values.update(_mean_formants(sound))

    missing = [n for n in FEATURE_NAMES if not np.isfinite(values.get(n, np.nan))]
    if missing:
        raise VoiceQualityError(f"Praat could not measure: {', '.join(missing)}")

    values["voicedSec"] = round(voiced_sec, 3)
    return values


def _mean_formants(sound: parselmouth.Sound) -> Dict[str, float]:
    """Mean F1..F4 over the vowel (Praat burg defaults)."""
    # Formants up to 5.5 kHz need >= 11 kHz sampling; Praat resamples down, never up.
    ceiling = min(FORMANT_CEILING_HZ, sound.sampling_frequency / 2 - 50)
    formant = call(sound, "To Formant (burg)", 0, N_FORMANTS, ceiling, 0.025, 50)
    out = {}
    for i in range(1, 5):
        out[f"f{i}"] = call(formant, "Get mean", i, 0, 0, "hertz")
    return out


def extract_from_file(path: str) -> Dict[str, Any]:
    return extract_from_sound(parselmouth.Sound(path))


def extract_from_array(samples: np.ndarray, sample_rate: int) -> Dict[str, Any]:
    return extract_from_sound(parselmouth.Sound(np.asarray(samples, dtype=np.float64), sampling_frequency=sample_rate))


def feature_vector(values: Dict[str, Any], male: Optional[bool]) -> Tuple[np.ndarray, list]:
    """Model input: the voice-report features followed by sex (1 = male, 0 = female, 0.5 = unknown)."""
    sex = 0.5 if male is None else float(bool(male))
    vec = [float(values[n]) for n in FEATURE_NAMES] + [sex]
    return np.asarray(vec, dtype=np.float64), FEATURE_NAMES + ["male"]
