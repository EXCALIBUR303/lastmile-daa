from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import pipeline
from app.core.trace import Tracer
from app.data.generator import generate
from app.models import GenerateRequest, Instance, SolveRequest, SolveResponse

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "stub_pipeline": pipeline.STUB}


@router.post("/instance/generate", response_model=Instance)
def instance_generate(req: GenerateRequest) -> Instance:
    try:
        return generate(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/solve", response_model=SolveResponse)
def solve(req: SolveRequest) -> SolveResponse:
    if req.instance is None and req.generate is None:
        raise HTTPException(status_code=422, detail="provide either `instance` or `generate`")
    try:
        inst = req.instance or generate(req.generate)  # type: ignore[arg-type]
        tracer = Tracer(enabled=req.config.trace)
        result, apsp = pipeline.solve(inst, req.config, tracer)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SolveResponse(
        instance=inst, result=result, trace=tracer.steps,
        truncated=tracer.truncated, stride=tracer.stride, stub=pipeline.STUB,
        apsp=apsp,
    )
