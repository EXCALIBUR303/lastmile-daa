from __future__ import annotations

import math
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
_BENCH_MAX_COMBOS = 36    # and so is the product of their lengths (12 x 12 of the biggest size is minutes of CPU)

# Value bounds for the sweep parameters a caller may override. Length caps alone
# are not enough: node_counts=[100000] is one entry and would still run for
# hours. Bounds mirror GenerateRequest's own limits.
_BENCH_BOUNDS: dict[str, tuple[float, float]] = {
    "node_counts": (3, 140),
    "n_orders_list": (1, 40),
    "capacities": (1, 100),
    "densities": (0.0, 0.9),
    "seeds": (0, 1_000_000),
    "seed": (0, 1_000_000),
}

# Hard ceilings for a caller-supplied `instance` (the generator path is already
# bounded by GenerateRequest).
_MAX_NODES, _MAX_EDGES, _MAX_ORDERS, _MAX_VEHICLES = 160, 6000, 60, 8


def _check_instance(inst: Instance) -> None:
    """Reject a hand-built instance the solver would crash on (dangling node
    ids, empty fleet, impossible orders) with a clear 422 instead of a 500, and
    refuse sizes that would tie the server up. ValueError -> 422 in the caller."""
    n = len(inst.nodes)
    if not 1 <= n <= _MAX_NODES:
        raise ValueError(f"instance must have 1..{_MAX_NODES} nodes, got {n}")
    if [nd.id for nd in inst.nodes] != list(range(n)):
        raise ValueError("node ids must be exactly 0..n-1 in list order")
    if len(inst.edges) > _MAX_EDGES:
        raise ValueError(f"instance has {len(inst.edges)} edges; max {_MAX_EDGES}")
    if len(inst.orders) > _MAX_ORDERS or len(inst.vehicles) > _MAX_VEHICLES:
        raise ValueError(f"max {_MAX_ORDERS} orders and {_MAX_VEHICLES} vehicles")
    if not inst.vehicles:
        raise ValueError("instance needs at least one vehicle")
    for e in inst.edges:
        if not (0 <= e.u < n and 0 <= e.v < n) or e.u == e.v:
            raise ValueError(f"edge {e.u}-{e.v} references a missing node or is a self-loop")
        if not all(math.isfinite(x) for x in (e.tau, e.cost, e.cost_vu)) or e.tau < 0:
            raise ValueError(f"edge {e.u}-{e.v} has a non-finite weight or negative travel time")
    if len({o.id for o in inst.orders}) != len(inst.orders):
        raise ValueError("order ids must be unique")
    for o in inst.orders:
        if not (0 <= o.pickup < n and 0 <= o.drop < n) or o.pickup == o.drop:
            raise ValueError(f"order {o.id}: pickup/drop must be two distinct existing nodes")
        if o.qty < 1 or not all(math.isfinite(x) for x in (o.release, o.deadline, o.profit, o.service)):
            raise ValueError(f"order {o.id}: quantity must be >= 1 and times/profit finite")
        if o.service < 0 or o.deadline < o.release:
            raise ValueError(f"order {o.id}: need service >= 0 and deadline >= release")
    for v in inst.vehicles:
        if not 0 <= v.depot < n or v.capacity < 1 or v.speed <= 0 or not v.shift_end > v.shift_start:
            raise ValueError(f"vehicle {v.id}: invalid depot, capacity, speed or shift window")


def _check_bench_value(key: str, value: object) -> None:
    bounds = _BENCH_BOUNDS.get(key)
    items = value if isinstance(value, list) else [value]
    for item in items:
        if bounds is None:
            continue  # unknown key: the sweep function itself rejects it (TypeError)
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item):
            raise HTTPException(status_code=422, detail=f"params.{key} must contain finite numbers")
        if not bounds[0] <= item <= bounds[1]:
            raise HTTPException(
                status_code=422,
                detail=f"params.{key} value {item} is outside the allowed range {bounds[0]}..{bounds[1]}",
            )


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
        if req.instance is not None:
            _check_instance(req.instance)
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
        _check_bench_value(key, value)
    combos = 1
    for value in req.params.values():
        if isinstance(value, list):
            combos *= max(1, len(value))
    if combos > _BENCH_MAX_COMBOS:
        raise HTTPException(
            status_code=422,
            detail=f"params describe {combos} combinations; max {_BENCH_MAX_COMBOS} on this endpoint",
        )
    t0 = time.perf_counter()
    try:
        rows = fn(**req.params)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid params for {req.experiment}: {exc}") from exc
    return BenchResponse(experiment=req.experiment, rows=rows,
                         runtime_ms=round((time.perf_counter() - t0) * 1000, 2))
