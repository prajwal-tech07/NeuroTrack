from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field


class IndicatorItem(BaseModel):
    key: str
    label: str
    value: Optional[float] = None
    unit: str = ""
    score: Optional[int] = None
    status: str = "unknown"  # normal, borderline, atypical, unknown
    normal: str = ""
    note: str = ""


class ModuleScoreResult(BaseModel):
    completed: bool = True
    score: int
    quality: float = 1.0
    durationSec: float = 0.0
    features: Dict[str, Any] = Field(default_factory=dict)
    indicators: List[IndicatorItem] = Field(default_factory=list)
    flags: List[str] = Field(default_factory=list)


class ConditionResult(BaseModel):
    condition: str  # "parkinsons" or "paralysis"
    score: int = Field(..., ge=0, le=100)
    riskLevel: str  # "low", "mild", "moderate", "high"
    riskLabel: str  # "Low Risk", "Mild Risk", etc.
    confidence: float = 0.85
    flags: List[str] = Field(default_factory=list)
    contributingFactors: List[str] = Field(default_factory=list)
    biomarkers: Dict[str, Any] = Field(default_factory=dict)


class DualConditionAssessmentResult(BaseModel):
    overallScore: int = Field(..., ge=0, le=100)
    riskLevel: str
    riskLabel: str
    riskTone: str
    scoringEngine: str = "ml-v1"
    engineVersion: str = "2.0.0"
    completedModules: List[str] = Field(default_factory=list)
    flags: List[str] = Field(default_factory=list)
    modules: Dict[str, Optional[ModuleScoreResult]] = Field(default_factory=dict)
    conditions: Dict[str, ConditionResult] = Field(default_factory=dict)
