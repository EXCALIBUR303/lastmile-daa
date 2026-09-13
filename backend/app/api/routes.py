from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from app.core import pipeline
from app.core.trace import Tracer
from app.data.generator import generate
from app.models import (
    BenchRequest, BenchResponse, GenerateRequest, Instance, SolveRequest, SolveResponse,
)
from bench.sweeps import (
    sweep_apsp_crossover, sweep_capacity, sweep_selector_quality, sweep_size,
    sweep_zoning_quality,
)

router = APIRouter(prefix="/api")

_BENCH_FN = {
    "apsp_crossover": sweep_apsp_crossover,
    "selector_quality": sweep_selector_quality,
    "zoning_quality": sweep_zoning_quality,
    "size": sweep_size,
    "capacity": sweep_capacity,
}
_BENCH_MAX_LIST_LEN = 12  # each list-valued param capped -- see /bench docstring


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


@router.post("/bench", response_model=BenchResponse)
def bench(req: BenchRequest) -> BenchResponse:
    """Step 8, live: the same sweep functions run_bench.py drives offline
    (bench/sweeps.py), on-demand for the dashboard. `params` overrides that
    sweep function's own keyword defaults (e.g. {"node_counts": [20, 40]});
    each list-valued override is capped at _BENCH_MAX_LIST_LEN entries --
    unlike the offline script, this is a live endpoint an interactive UI can
    call repeatedly, so a caller-supplied param can't be allowed to blow up
    the sweep's combinatorial size (e.g. selector_quality is O(orders_list *
    seeds_list * 4); left uncapped, two 100-entry lists would mean 40,000
    solves on one request).
    """
    fn = _BENCH_FN[req.experiment]
    for key, value in req.params.items():
        if isinstance(value, list) and len(value) > _BENCH_MAX_LIST_LEN:
            raise HTTPException(
                status_code=422,
                detail=f"params.{key} has {len(value)} entries; max {_BENCH_MAX_LIST_LEN} on this endpoint "
                       f"(run bench/run_bench.py locally for the full-size offline sweep)",
            )
    t0 = time.perf_counter()
    try:
        rows = fn(**req.params)
    except TypeError as exc:
        raise HTTPException(status_code=422, detail=f"invalid params for {req.experiment}: {exc}") from exc
    return BenchResponse(experiment=req.experiment, rows=rows,
                         runtime_ms=round((time.perf_counter() - t0) * 1000, 2))
