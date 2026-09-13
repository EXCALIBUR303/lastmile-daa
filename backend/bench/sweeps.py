"""Reusable experiment sweeps -- pure functions returning list[dict] rows.

Shared by `run_bench.py` (the standalone script: full sweeps, matplotlib
PNGs, a CSV per experiment) and `POST /api/bench` (a fast subset for the
live dashboard). Every function here is otherwise-side-effect-free: no file
I/O, no printing -- that split is what lets the exact same measurement code
serve both an offline report and an interactive endpoint.

Rubric mapping (DAA Internal Assessment: "vary graph size, density, capacity
constraints; measure runtime and solution quality"):
    size      -> sweep_size
    density   -> sweep_apsp_crossover (density is what actually drives the
                 Dijkstra/Floyd-Warshall/Johnson choice, so it gets the
                 detailed isolated-timing treatment, not just a size proxy)
    capacity  -> sweep_capacity
    quality   -> sweep_selector_quality (also folds in sweep_zoning_quality)
"""
from __future__ import annotations

import time
from typing import Literal

from app.core.apsp import floyd_warshall, johnson
from app.core.graph import Graph
from app.core.pipeline import solve
from app.core.sssp import dijkstra
from app.core.trace import Tracer
from app.data.generator import generate
from app.models import GenerateRequest, SolveConfig

Selector = Literal["dp_deadline", "dp_01", "greedy_density", "greedy_edd"]
ApspMode = Literal["dijkstra", "floyd", "johnson"]
ZoningMode = Literal["prim", "kruskal", "none"]

def _silent_solve(gen: GenerateRequest, cfg: SolveConfig):
    """A FRESH Tracer(enabled=False) per call, deliberately never shared or
    reused across sweep iterations -- a Tracer accumulates op_counts across
    every call it sees, so reusing one across unrelated runs would silently
    mix their totals together. Steps are never recorded either way
    (enabled=False), only the op_counts a caller might still want (e.g. the
    "repair" count read by sweep_selector_quality below).
    """
    inst = generate(gen)
    tracer = Tracer(enabled=False)
    result, _ = solve(inst, cfg, tracer)
    return inst, result, tracer


# --------------------------------------------------------------------------- #
# 1. APSP crossover -- density is the axis that actually matters here: it's
#    what sets m relative to n^2, which is exactly what separates Dijkstra's
#    O(k(n+m)log n), Floyd-Warshall's O(n^3), and Johnson's O(nm + n(n+m)log n).
# --------------------------------------------------------------------------- #


def sweep_apsp_crossover(
    node_counts: list[int] = [20, 40, 60, 80, 100],
    densities: list[float] = [0.05, 0.15, 0.3, 0.5, 0.7],
    seed: int = 1,
) -> list[dict]:
    """Isolates S2's metric-closure computation from the rest of the
    pipeline: zoning/selection/sequencing add roughly constant overhead
    that would dilute the density-driven crossover this specifically
    targets, so this calls dijkstra()/floyd_warshall()/johnson() directly
    -- the exact functions pipeline.py's S2 branch dispatches to -- rather
    than timing the full solve().
    """
    rows: list[dict] = []
    for n in node_counts:
        for density in densities:
            n_orders = max(2, n // 4)
            try:
                inst = generate(GenerateRequest(
                    seed=seed, n_nodes=n, density=density, n_orders=n_orders,
                    n_vehicles=1, capacity=1000, horizon=100_000,
                ))
            except ValueError:
                continue  # n too small for n_orders at this n // 4 ratio
            g = Graph.from_instance(inst)
            sources = sorted(
                {0} | {o.pickup for o in inst.orders} | {o.drop for o in inst.orders}
            )

            t0 = time.perf_counter()
            for s in sources:
                dijkstra(g, s)
            t_dijkstra = (time.perf_counter() - t0) * 1000

            t0 = time.perf_counter()
            floyd_warshall(g)
            t_floyd = (time.perf_counter() - t0) * 1000

            t0 = time.perf_counter()
            johnson(g)
            t_johnson = (time.perf_counter() - t0) * 1000

            for mode, t in (("dijkstra", t_dijkstra), ("floyd", t_floyd), ("johnson", t_johnson)):
                rows.append({
                    "n": n, "m": inst.meta["m"], "density": density,
                    "k_sources": len(sources), "mode": mode, "runtime_ms": round(t, 4),
                })
    return rows


# --------------------------------------------------------------------------- #
# 2. Selector quality -- full pipeline, varying ONLY the selector, so the
#    comparison reflects real achieved (post-repair) profit, not just the
#    surrogate objective (already unit-tested directly in test_knapsack.py).
# --------------------------------------------------------------------------- #


def sweep_selector_quality(
    n_orders_list: list[int] = [6, 10, 16, 24, 32],
    seeds: list[int] = [1, 2, 3, 4, 5],
) -> list[dict]:
    rows: list[dict] = []
    selectors: list[Selector] = ["dp_deadline", "dp_01", "greedy_density", "greedy_edd"]
    for n_orders in n_orders_list:
        n_nodes = max(32, 2 * n_orders + 8)
        for seed in seeds:
            for selector in selectors:
                gen = GenerateRequest(seed=seed, n_nodes=n_nodes, n_orders=n_orders)
                try:
                    _, result, trace = _silent_solve(gen, SolveConfig(selector=selector))
                except ValueError:
                    continue
                repairs = trace.op_counts.get("repair", 0)
                rows.append({
                    "n_orders": n_orders, "seed": seed, "selector": selector,
                    "profit": result.metrics.total_profit,
                    "dp_bound": result.metrics.dp_bound,
                    "bound_gap_pct": result.metrics.bound_gap_pct,
                    "repair_drops": repairs,
                    "runtime_ms": result.metrics.runtime_ms,
                })
    return rows


# --------------------------------------------------------------------------- #
# 3. Zoning quality -- MST (Prim/Kruskal) vs the round-robin baseline.
# --------------------------------------------------------------------------- #


def sweep_zoning_quality(seeds: list[int] = list(range(1, 21))) -> list[dict]:
    rows: list[dict] = []
    zonings: list[ZoningMode] = ["prim", "kruskal", "none"]
    for seed in seeds:
        for zoning in zonings:
            gen = GenerateRequest(seed=seed)
            _, result, _ = _silent_solve(gen, SolveConfig(zoning=zoning))
            rows.append({
                "seed": seed, "zoning": zoning,
                "total_travel_time": result.metrics.total_travel_time,
                "total_profit": result.metrics.total_profit,
            })
    return rows


# --------------------------------------------------------------------------- #
# 4. Size -- overall pipeline runtime and quality as the instance grows.
# --------------------------------------------------------------------------- #


def sweep_size(
    node_counts: list[int] = [20, 40, 60, 80, 100, 130],
    seeds: list[int] = [1, 2, 3],
) -> list[dict]:
    rows: list[dict] = []
    for n in node_counts:
        n_orders = max(2, n // 3)
        for seed in seeds:
            gen = GenerateRequest(seed=seed, n_nodes=n, n_orders=n_orders,
                                  n_vehicles=max(1, n_orders // 6))
            try:
                _, result, _ = _silent_solve(gen, SolveConfig())
            except ValueError:
                continue
            rows.append({
                "n_nodes": n, "n_orders": n_orders, "seed": seed,
                "runtime_ms": result.metrics.runtime_ms,
                "profit": result.metrics.total_profit,
                "bound_gap_pct": result.metrics.bound_gap_pct,
                "on_time_pct": result.metrics.on_time_pct,
            })
    return rows


# --------------------------------------------------------------------------- #
# 5. Capacity -- how much slack/tightness changes achieved quality.
# --------------------------------------------------------------------------- #


def sweep_capacity(
    capacities: list[int] = [4, 8, 12, 16, 20, 25, 30],
    seeds: list[int] = [1, 2, 3],
) -> list[dict]:
    rows: list[dict] = []
    for cap in capacities:
        for seed in seeds:
            gen = GenerateRequest(seed=seed, capacity=cap)
            _, result, _ = _silent_solve(gen, SolveConfig())
            rows.append({
                "capacity": cap, "seed": seed,
                "profit": result.metrics.total_profit,
                "avg_utilisation": result.metrics.avg_utilisation,
                "on_time_pct": result.metrics.on_time_pct,
            })
    return rows
