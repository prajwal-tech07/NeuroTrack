from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class VoiceFeatures(BaseModel):
    durationSec: float = 0.0
    jitterPercent: Optional[float] = None
    shimmerPercent: Optional[float] = None
    hnrDb: Optional[float] = None
    f0Mean: Optional[float] = None
    f0StdSemitones: Optional[float] = None
    voicedRatio: Optional[float] = None
    pauseRatio: Optional[float] = None
    speechRateSyll: Optional[float] = None
    maxPhonationSec: Optional[float] = None
    intensityCv: Optional[float] = None
    snrDb: Optional[float] = None
    frameCount: Optional[int] = None


class FaceFeatures(BaseModel):
    durationSec: float = 0.0
    blinkRate: Optional[float] = None
    blinkCount: Optional[int] = None
    expressivityIndex: Optional[float] = None
    smileAmplitude: Optional[float] = None
    smileAmplitudeLeft: Optional[float] = None
    smileAmplitudeRight: Optional[float] = None
    browRaiseAmplitude: Optional[float] = None
    browRaiseLeft: Optional[float] = None
    browRaiseRight: Optional[float] = None
    asymmetryIndex: Optional[float] = None
    mouthOpenRange: Optional[float] = None
    eyeApertureLeft: Optional[float] = None
    eyeApertureRight: Optional[float] = None
    eyeOpenAsymmetry: Optional[float] = None
    eyeApertureCv: Optional[float] = None
    trackedRatio: Optional[float] = None
    brightness: Optional[float] = None
    frameCount: Optional[int] = None


class HandFeatures(BaseModel):
    durationSec: float = 0.0
    tapFrequencyHz: Optional[float] = None
    tapCount: Optional[int] = None
    tapAmplitudeMean: Optional[float] = None
    tapAmplitudeDecay: Optional[float] = None
    tapIntervalCv: Optional[float] = None
    tapHesitations: Optional[int] = None
    tremorPeakHz: Optional[float] = None
    tremorPowerRatio: Optional[float] = None
    holdDriftPx: Optional[float] = None
    holdJitter: Optional[float] = None
    trackedRatio: Optional[float] = None
    sampleCount: Optional[int] = None
    tapAnalysed: Optional[bool] = None
    holdAnalysed: Optional[bool] = None
    # Optional raw spatial-temporal time-series for 1D CNN / BiLSTM
    timeSeriesTapDistances: Optional[List[float]] = None
    timeSeriesHoldTrajectory: Optional[List[List[float]]] = None


class GaitFeatures(BaseModel):
    durationSec: float = 0.0
    cadenceStepsMin: Optional[float] = None
    stepCount: Optional[int] = None
    leftStepCount: Optional[int] = None
    rightStepCount: Optional[int] = None
    stepTimeCv: Optional[float] = None
    stepSymmetry: Optional[float] = None
    armSwingAmplitude: Optional[float] = None
    armSwingAsymmetry: Optional[float] = None
    trunkSwayIndex: Optional[float] = None
    posturalLeanDeg: Optional[float] = None
    doubleSupportRatio: Optional[float] = None
    trackedRatio: Optional[float] = None
    frameCount: Optional[int] = None
    # Optional joint coordinate matrix for ST-GCN
    spatialTemporalJoints: Optional[List[List[List[float]]]] = None


class ModulePayload(BaseModel):
    features: Dict[str, Any] = Field(default_factory=dict)
    quality: float = 1.0
    durationSec: float = 0.0


class AssessmentPayload(BaseModel):
    modules: Dict[str, ModulePayload] = Field(default_factory=dict)
    age: Optional[int] = None
