// Mirror of backend/app/models.py -- keep the two in lockstep.

export type NodeKind = "depot" | "pickup" | "drop" | "junction"
export type Topology = "radial" | "grid" | "scale_free"

export interface GNode { id: number; x: number; y: number; kind: NodeKind; label: string }
export interface GEdge { u: number; v: number; tau: number; cost: number; cost_vu: number }
export interface Order {
  id: number; pickup: number; drop: number; release: number
  deadline: number; qty: number; profit: number; service: number
}
export interface Vehicle {
  id: number; depot: number; capacity: number
  shift_start: number; shift_end: number; speed: number
}
export interface Instance {
  seed: number; topology: Topology
  nodes: GNode[]; edges: GEdge[]; orders: Order[]; vehicles: Vehicle[]
  meta: Record<string, number | string>
}

export type Stage =
  | "build" | "dijkstra" | "bellman" | "floyd" | "johnson"
  | "mst" | "knapsack" | "heldkarp" | "twoopt" | "sim" | "repair"

export interface Step {
  stage: Stage
  kind: string
  payload: Record<string, unknown>
  ops: number
}

export interface StopVisit {
  node: number; order_id: number | null
  action: "depart_depot" | "pickup" | "drop" | "return_depot"
  arrive: number; depart: number; load: number
  slack: number | null; late: boolean
}
export interface VehiclePlan {
  vehicle_id: number; zone: number[]; selected: number[]; route: number[]
  visits: StopVisit[]; profit: number; travel_time: number; travel_cost: number
  mst_lower_bound: number | null
  peak_load: number; feasible: boolean
}
export interface Metrics {
  total_profit: number; orders_served: number; orders_total: number
  on_time_pct: number; total_travel_time: number; avg_utilisation: number
  total_cost: number; net_profit: number; negative_cost_cycle: boolean
  dp_bound: number | null; bound_gap_pct: number | null
  runtime_ms: number; ops: Record<string, number>
}
export interface SolveResult { plans: VehiclePlan[]; unserved: number[]; metrics: Metrics }

export interface ApspMatrixData {
  algorithm: "floyd" | "johnson"
  node_ids: number[]
  matrix: (number | null)[][]
}

export interface GenerateRequest {
  seed: number; n_nodes: number; density: number; topology: Topology
  n_orders: number; n_vehicles: number; capacity: number
  horizon: number; neg_cost_frac: number
}
export interface SolveConfig {
  apsp: "dijkstra" | "floyd" | "johnson"
  selector: "dp_deadline" | "dp_01" | "greedy_density" | "greedy_edd"
  sequencer: "auto" | "held_karp" | "insertion_2opt"
  zoning: "prim" | "kruskal" | "none"
  trace: boolean
}
export interface SolveResponse {
  instance: Instance; result: SolveResult; trace: Step[]
  truncated: boolean; stride: number; stub: boolean
  apsp: ApspMatrixData | null
}
