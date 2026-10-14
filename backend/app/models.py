"""Frozen wire contract between the Python solver and the React dashboard.

Nothing in this file may change shape once the API is published without updating
frontend/src/types.ts in the same commit.  The whole point of writing it first
is that the two halves of the team can build in parallel against it.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

NodeKind = Literal["depot", "pickup", "drop", "junction"]
Topology = Literal["radial", "grid", "scale_free"]

# --------------------------------------------------------------------------- #
# Instance
# --------------------------------------------------------------------------- #


class Node(BaseModel):
    id: int
    x: float  # normalised to [0,1] so the SVG viewBox never has to rescale
    y: float
    kind: NodeKind
    label: str = ""


class Edge(BaseModel):
    u: int
    v: int
    tau: float  # travel minutes, always >= 0, SAME both directions
    cost: float      # money for the u->v direction, MAY BE NEGATIVE (a subsidy)
    cost_vu: float   # money for the v->u direction.
    # Deliberately allowed to differ from `cost`: on an UNDIRECTED graph, a
    # single edge with the SAME negative cost both ways is a trivial negative
    # cycle (u->v->u nets 2*cost < 0), which would make Bellman-Ford's
    # negative-cycle guard fire on almost every instance with any subsidy at
    # all. Modelling the subsidy as one-way (e.g. inbound-to-depot pricing)
    # keeps every round trip >= 0 by construction, so a guard hit means a real
    # multi-edge cycle of chained subsidies, not this degenerate case.


class Order(BaseModel):
    id: int
    pickup: int
    drop: int
    release: float = 0.0
    deadline: float
    qty: int
    profit: float
    service: float  # pickup service + drop service, minutes


class Vehicle(BaseModel):
    id: int
    depot: int
    capacity: int
    shift_start: float
    shift_end: float
    speed: float = 1.0


class Instance(BaseModel):
    seed: int
    topology: Topology
    nodes: list[Node]
    edges: list[Edge]
    orders: list[Order]
    vehicles: list[Vehicle]
    meta: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Trace  (see core/trace.py for the emitting side)
# --------------------------------------------------------------------------- #

Stage = Literal[
    "build", "dijkstra", "bellman", "floyd", "johnson",
    "mst", "knapsack", "heldkarp", "twoopt", "sim", "repair",
]


class Step(BaseModel):
    stage: Stage
    kind: str
    payload: dict[str, Any] = Field(default_factory=dict)
    ops: int = 0


# --------------------------------------------------------------------------- #
# Result
# --------------------------------------------------------------------------- #


class StopVisit(BaseModel):
    node: int
    order_id: int | None = None
    action: Literal["depart_depot", "pickup", "drop", "return_depot"]
    arrive: float
    depart: float
    load: int
    slack: float | None = None  # deadline - arrive, only on `drop`
    late: bool = False


class VehiclePlan(BaseModel):
    vehicle_id: int
    zone: list[int] = Field(default_factory=list)      # order ids in this vehicle's zone
    selected: list[int] = Field(default_factory=list)  # order ids the selector committed to
    route: list[int] = Field(default_factory=list)     # node sequence actually driven
    visits: list[StopVisit] = Field(default_factory=list)
    profit: float = 0.0
    travel_time: float = 0.0
    travel_cost: float = 0.0  # sum of directional edge cost along `route`
    mst_lower_bound: float | None = None  # TSP lower bound for this zone
    dp_bound: float = 0.0  # Dantzig LP bound for this vehicle's zone
    peak_load: int = 0
    feasible: bool = True


class Metrics(BaseModel):
    total_profit: float = 0.0
    orders_served: int = 0
    orders_total: int = 0
    on_time_pct: float = 100.0
    total_travel_time: float = 0.0
    total_cost: float = 0.0    # accumulated directional edge cost
    net_profit: float = 0.0    # total_profit - total_cost
    negative_cost_cycle: bool = False  # Bellman-Ford flag, see pipeline.py S1
    avg_utilisation: float = 0.0  # peak_load / capacity, averaged over vehicles
    dp_bound: float | None = None
    bound_gap_pct: float | None = None
    runtime_ms: float = 0.0
    ops: dict[str, int] = Field(default_factory=dict)


class ApspMatrix(BaseModel):
    """All-pairs closure, populated only when `SolveConfig.apsp` picks
    "floyd" or "johnson" -- the "dijkstra" mode never builds a full n x n
    matrix, so this stays None then (see pipeline.py's S2 branch)."""
    algorithm: Literal["floyd", "johnson"]
    node_ids: list[int]
    matrix: list[list[float | None]]  # None = unreachable (JSON has no Infinity)


class SolveResult(BaseModel):
    plans: list[VehiclePlan] = Field(default_factory=list)
    unserved: list[int] = Field(default_factory=list)
    metrics: Metrics = Field(default_factory=Metrics)


# --------------------------------------------------------------------------- #
# Requests / responses
# --------------------------------------------------------------------------- #


class GenerateRequest(BaseModel):
    """Bounds are enforced here, server-side, not just by the dashboard's
    sliders: this is a public endpoint, and an unbounded `n_nodes` (the solver
    is O(n^3) in the worst case) is a one-request denial of service. The caps
    sit just above what the UI offers; the generator itself still reports the
    friendlier "need at least N nodes for M orders" message below them."""

    seed: int = Field(42, ge=0, le=1_000_000)
    n_nodes: int = Field(32, ge=3, le=160)
    density: float = Field(0.18, ge=0.0, le=0.9)  # extra chords beyond the connected skeleton
    topology: Topology = "radial"
    n_orders: int = Field(12, ge=1, le=60)
    n_vehicles: int = Field(3, ge=1, le=8)
    capacity: int = Field(10, ge=1, le=200)
    horizon: float = Field(480.0, ge=30.0, le=5000.0)  # shift length, minutes
    neg_cost_frac: float = Field(0.08, ge=0.0, le=0.5)  # share of edges carrying a subsidy (cost < 0)


class SolveConfig(BaseModel):
    apsp: Literal["dijkstra", "floyd", "johnson"] = "dijkstra"
    selector: Literal["dp_deadline", "dp_01", "greedy_density", "greedy_edd"] = "dp_deadline"
    sequencer: Literal["auto", "held_karp", "insertion_2opt"] = "auto"
    zoning: Literal["prim", "kruskal", "none"] = "prim"
    trace: bool = True


class SolveRequest(BaseModel):
    instance: Instance | None = None
    generate: GenerateRequest | None = None
    config: SolveConfig = Field(default_factory=SolveConfig)


class SolveResponse(BaseModel):
    instance: Instance
    result: SolveResult
    trace: list[Step] = Field(default_factory=list)
    truncated: bool = False
    stride: int = 1
    stub: bool = False  # False: no placeholder stages remain (see pipeline.py)
    apsp: ApspMatrix | None = None  # set only for apsp="floyd"|"johnson"


# --------------------------------------------------------------------------- #
# Experiment sweeps (S8)
# --------------------------------------------------------------------------- #

BenchExperiment = Literal["apsp_crossover", "selector_quality", "zoning_quality", "size", "capacity"]


class BenchRequest(BaseModel):
    experiment: BenchExperiment
    # Deliberately untyped per-experiment overrides (e.g. {"node_counts":
    # [20,40], "seeds": [1,2]}) rather than one field per possible sweep
    # parameter across five different experiment shapes; validated by
    # calling the target sweep function itself, which is the single source
    # of truth for what each experiment actually accepts.
    params: dict[str, Any] = Field(default_factory=dict)


class BenchResponse(BaseModel):
    experiment: BenchExperiment
    rows: list[dict[str, Any]] = Field(default_factory=list)
    runtime_ms: float = 0.0
