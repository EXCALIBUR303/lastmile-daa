"""Frozen wire contract between the Python solver and the React dashboard.

Nothing in this file may change shape after Step 1 without updating
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
    travel_cost: float = 0.0  # sum of directional edge cost along `route` (Step 4)
    mst_lower_bound: float | None = None  # Step 5: TSP lower bound for this zone
    peak_load: int = 0
    feasible: bool = True


class Metrics(BaseModel):
    total_profit: float = 0.0
    orders_served: int = 0
    orders_total: int = 0
    on_time_pct: float = 100.0
    total_travel_time: float = 0.0
    total_cost: float = 0.0    # Step 4: accumulated directional edge cost
    net_profit: float = 0.0    # Step 4: total_profit - total_cost
    negative_cost_cycle: bool = False  # Step 4: Bellman-Ford flag, see pipeline.py S1
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
    seed: int = 42
    n_nodes: int = 32
    density: float = 0.18  # extra chords beyond the connected skeleton
    topology: Topology = "radial"
    n_orders: int = 12
    n_vehicles: int = 3
    capacity: int = 10
    horizon: float = 480.0  # shift length, minutes
    neg_cost_frac: float = 0.08  # share of edges carrying a subsidy (cost < 0)


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
    stub: bool = False  # True while the pipeline is still the Step-1 placeholder
    apsp: ApspMatrix | None = None  # Step 4: set only for apsp="floyd"|"johnson"
