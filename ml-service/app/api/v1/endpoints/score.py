import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException, status
from app.schemas.features import AssessmentPayload
from app.schemas.results import DualConditionAssessmentResult, ConditionResult
from app.services.ml.ensemble import ensemble_service

router = APIRouter()
thread_pool = ThreadPoolExecutor(max_workers=4)


@router.post("/fusion", response_model=DualConditionAssessmentResult)
async def score_fusion(payload: AssessmentPayload):
    """
    Evaluates multi-modal biomarkers and outputs dual-condition screening results:
    1. Parkinson's Disease (Bradykinesia, Tremor, Hypomimia, Dysphonia)
    2. Paralysis / Stroke (Facial Asymmetry, Hemiparetic Gait, Motor Weakness)
    """
    loop = asyncio.get_event_loop()
    try:
        modules_dict = {
            k: v.model_dump() for k, v in payload.modules.items()
        }
        result = await loop.run_in_executor(
            thread_pool,
            ensemble_service.evaluate_assessment,
            modules_dict,
            payload.age,
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference error: {str(e)}",
        )


@router.post("/parkinsons", response_model=ConditionResult)
async def score_parkinsons(payload: AssessmentPayload):
    """
    Evaluates Parkinson's Disease specific risk.
    """
    loop = asyncio.get_event_loop()
    try:
        modules_dict = {k: v.model_dump() for k, v in payload.modules.items()}
        res_dict = await loop.run_in_executor(
            thread_pool,
            ensemble_service.parkinsons_classifier.predict,
            modules_dict,
            payload.age,
        )
        return ConditionResult(**res_dict)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Parkinsons inference error: {str(e)}",
        )


@router.post("/paralysis", response_model=ConditionResult)
async def score_paralysis(payload: AssessmentPayload):
    """
    Evaluates Paralysis / Stroke specific risk.
    """
    loop = asyncio.get_event_loop()
    try:
        modules_dict = {k: v.model_dump() for k, v in payload.modules.items()}
        res_dict = await loop.run_in_executor(
            thread_pool,
            ensemble_service.paralysis_classifier.predict,
            modules_dict,
            payload.age,
        )
        return ConditionResult(**res_dict)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Paralysis inference error: {str(e)}",
        )
