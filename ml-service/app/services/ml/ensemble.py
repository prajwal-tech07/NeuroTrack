from typing import Dict, Any, List, Optional
import numpy as np
from app.services.ml.parkinsons_model import ParkinsonsClassifier
from app.services.ml.paralysis_model import ParalysisClassifier
from app.services.cv.hand_pipeline import HandPipeline
from app.services.cv.face_pipeline import FacePipeline
from app.services.cv.gait_pipeline import GaitPipeline
from app.services.cv.voice_pipeline import VoicePipeline
from app.schemas.results import (
    DualConditionAssessmentResult,
    ConditionResult,
    ModuleScoreResult,
    IndicatorItem,
)


class MultiModelEnsemble:
    def __init__(self):
        self.parkinsons_classifier = ParkinsonsClassifier()
        self.paralysis_classifier = ParalysisClassifier()

    def evaluate_assessment(self, modules: Dict[str, Any], age: Optional[int] = None) -> DualConditionAssessmentResult:
        # 1. Run each module pipeline
        module_results: Dict[str, Optional[ModuleScoreResult]] = {}
        all_flags: List[str] = []
        completed_keys: List[str] = []

        # Voice
        if "voice" in modules and modules["voice"]:
            vm = modules["voice"]
            feat = vm.get("features", {})
            score, flags, indicators = VoicePipeline.compute_rule_score(feat, age)
            q = float(vm.get("quality", 1.0))
            dur = float(feat.get("durationSec") or vm.get("durationSec", 0.0))
            all_flags.extend(flags)
            completed_keys.append("voice")
            module_results["voice"] = ModuleScoreResult(
                completed=True,
                score=score,
                quality=q,
                durationSec=dur,
                features=feat,
                indicators=[IndicatorItem(**ind) for ind in indicators],
                flags=flags,
            )
        else:
            module_results["voice"] = None

        # Face
        if "face" in modules and modules["face"]:
            fm = modules["face"]
            feat = fm.get("features", {})
            score, flags, indicators = FacePipeline.compute_rule_score(feat)
            q = float(fm.get("quality", 1.0))
            dur = float(feat.get("durationSec") or fm.get("durationSec", 0.0))
            all_flags.extend(flags)
            completed_keys.append("face")
            module_results["face"] = ModuleScoreResult(
                completed=True,
                score=score,
                quality=q,
                durationSec=dur,
                features=feat,
                indicators=[IndicatorItem(**ind) for ind in indicators],
                flags=flags,
            )
        else:
            module_results["face"] = None

        # Hand
        if "hand" in modules and modules["hand"]:
            hm = modules["hand"]
            feat = hm.get("features", {})
            score, flags, indicators = HandPipeline.compute_rule_score(feat)
            q = float(hm.get("quality", 1.0))
            dur = float(feat.get("durationSec") or hm.get("durationSec", 0.0))
            all_flags.extend(flags)
            completed_keys.append("hand")
            module_results["hand"] = ModuleScoreResult(
                completed=True,
                score=score,
                quality=q,
                durationSec=dur,
                features=feat,
                indicators=[IndicatorItem(**ind) for ind in indicators],
                flags=flags,
            )
        else:
            module_results["hand"] = None

        # Gait
        if "gait" in modules and modules["gait"]:
            gm = modules["gait"]
            feat = gm.get("features", {})
            score, flags, indicators = GaitPipeline.compute_rule_score(feat)
            q = float(gm.get("quality", 1.0))
            dur = float(feat.get("durationSec") or gm.get("durationSec", 0.0))
            all_flags.extend(flags)
            completed_keys.append("gait")
            module_results["gait"] = ModuleScoreResult(
                completed=True,
                score=score,
                quality=q,
                durationSec=dur,
                features=feat,
                indicators=[IndicatorItem(**ind) for ind in indicators],
                flags=flags,
            )
        else:
            module_results["gait"] = None

        if not completed_keys:
            raise ValueError("At least one usable test module is required.")

        # 2. Run Condition Classifiers
        pd_res_dict = self.parkinsons_classifier.predict(modules, age)
        paralysis_res_dict = self.paralysis_classifier.predict(modules, age)

        all_flags.extend(pd_res_dict.get("flags", []))
        all_flags.extend(paralysis_res_dict.get("flags", []))

        conditions = {
            "parkinsons": ConditionResult(**pd_res_dict),
            "paralysis": ConditionResult(**paralysis_res_dict),
        }

        # 3. Compute General Neurological Composite Overall Score
        # Weighted blend of condition scores + weakest-link penalty
        pd_score = conditions["parkinsons"].score
        para_score = conditions["paralysis"].score
        
        base_composite = (pd_score * 0.52) + (para_score * 0.48)
        min_cond = min(pd_score, para_score)
        spread = base_composite - min_cond
        penalty = min(8.0, (spread - 10.0) * 0.35) if spread > 10.0 else 0.0

        # Coverage cap if not all 4 modules completed
        coverage_cap = 100 if len(completed_keys) == 4 else (88 - (4 - len(completed_keys)) * 4)
        overall_score = int(np.clip(min(base_composite - penalty, coverage_cap), 0, 100))

        if overall_score >= 80:
            risk_level = "low"
            risk_label = "Low Risk"
            risk_tone = "Healthy"
        elif overall_score >= 65:
            risk_level = "mild"
            risk_label = "Mild Risk"
            risk_tone = "Monitor"
        elif overall_score >= 50:
            risk_level = "moderate"
            risk_label = "Moderate Risk"
            risk_tone = "Needs attention"
        else:
            risk_level = "high"
            risk_label = "High Risk"
            risk_tone = "Consult a clinician"

        return DualConditionAssessmentResult(
            overallScore=overall_score,
            riskLevel=risk_level,
            riskLabel=risk_label,
            riskTone=risk_tone,
            scoringEngine="ml-v1",
            engineVersion="2.0.0",
            completedModules=completed_keys,
            flags=list(set(all_flags)),
            modules=module_results,
            conditions=conditions,
        )


ensemble_service = MultiModelEnsemble()
