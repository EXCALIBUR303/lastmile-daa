// A pure fold over the trace. The view is a function of (trace, cursor) and
// nothing else -- which is why rendering can never re-enter the solver.
import type { Step } from "../types"

export interface ViewState {
  settled: Set<number>            // dijkstra: popped & finalised
  frontier: Set<number>           // dijkstra: in the priority queue
  relaxed: Set<string>            // "u-v" keys of successfully relaxed edges
  mstEdges: Set<string>           // step 5
  dpRow: number                   // step 6
  dpCells: Map<string, number>    // step 6, "t,c" -> value
  apspK: number                   // step 4: floyd's current k-phase, -1 before it starts
  bfNegativeCycle: boolean | null // step 4: set once bellman's "done" event plays
  vehicle: number | null
  clock: number
  at: Map<number, number>         // vehicle -> node it is standing on
  pickedUp: Set<number>
  dropped: Set<number>
  late: Set<number>
  log: { stage: string; kind: string; text: string }[]
}

const LOG_MAX = 90
const CHECKPOINT_EVERY = 250

export const emptyView = (): ViewState => ({
  settled: new Set(), frontier: new Set(), relaxed: new Set(), mstEdges: new Set(),
  dpRow: -1, dpCells: new Map(), apspK: -1, bfNegativeCycle: null,
  vehicle: null, clock: 0, at: new Map(),
  pickedUp: new Set(), dropped: new Set(), late: new Set(), log: [],
})

const clone = (v: ViewState): ViewState => ({
  settled: new Set(v.settled), frontier: new Set(v.frontier),
  relaxed: new Set(v.relaxed), mstEdges: new Set(v.mstEdges),
  dpRow: v.dpRow, dpCells: new Map(v.dpCells),
  apspK: v.apspK, bfNegativeCycle: v.bfNegativeCycle,
  vehicle: v.vehicle, clock: v.clock, at: new Map(v.at),
  pickedUp: new Set(v.pickedUp), dropped: new Set(v.dropped),
  late: new Set(v.late), log: v.log.slice(),
})

const ekey = (u: number, v: number) => (u < v ? `${u}-${v}` : `${v}-${u}`)
const num = (p: Record<string, unknown>, k: string) => (p[k] as number) ?? 0

function describe(s: Step): string {
  const p = s.payload
  switch (s.kind) {
    case "vehicle_start":  return `vehicle ${num(p, "vehicle")} starts · zone ${(p.zone as number[])?.length ?? 0} orders`
    case "pickup":         return `veh ${num(p, "vehicle")} picks up order ${num(p, "order")} @ n${num(p, "node")} · t=${num(p, "clock")} load=${num(p, "load")}`
    case "drop":           return `veh ${num(p, "vehicle")} drops order ${num(p, "order")} · t=${num(p, "clock")} slack=${num(p, "slack")}`
    case "deadline_miss":  return `veh ${num(p, "vehicle")} MISSED order ${num(p, "order")} by ${Math.abs(num(p, "slack")).toFixed(1)} min`
    case "vehicle_end":    return `vehicle ${num(p, "vehicle")} back at depot · t=${num(p, "clock")} profit=${num(p, "profit")}`
    case "validate":       return `graph validated · n=${num(p, "n")} m=${num(p, "m")}`
    case "pop":            return `pop n${num(p, "node")} · dist=${num(p, "dist")}`
    case "settle":         return `settle n${num(p, "node")} · dist=${num(p, "dist")}`
    case "relax_try":      return `try ${num(p, "u")}→${num(p, "v")} (w=${num(p, "w")})`
    case "relax_ok":       return `relax ${num(p, "u")}→${num(p, "v")} · new=${num(p, "new")}`
    case "round_start":    return `BF round ${num(p, "round")}${p.detailed === false ? " (converging…)" : ""}`
    case "done":           return p.negative_cycle ? "Bellman-Ford: negative cycle found ⚠" : "Bellman-Ford: converged, no negative cycle"
    case "k_phase":        return `Floyd-Warshall: k=${num(p, "k")}`
    case "edge_consider":  return `MST: consider ${num(p, "u")}–${num(p, "v")} (w=${num(p, "w")})`
    case "edge_accept":    return `MST: accept ${num(p, "u")}–${num(p, "v")} (w=${num(p, "w")})`
    case "edge_reject":    return `MST: reject ${num(p, "u")}–${num(p, "v")} (${p.reason ?? "skip"})`
    case "cut":            return `MST: cut ${num(p, "u")}–${num(p, "v")} → new zone boundary`
    default:               return `${s.stage}/${s.kind}`
  }
}

/** Apply one step in place. Adding a stage later means adding a case here only. */
function apply(v: ViewState, s: Step): void {
  const p = s.payload
  switch (s.stage) {
    case "dijkstra":
      if (s.kind === "settle") { v.settled.add(num(p, "node")); v.frontier.delete(num(p, "node")) }
      else if (s.kind === "relax_ok") { v.relaxed.add(ekey(num(p, "u"), num(p, "v"))); v.frontier.add(num(p, "v")) }
      break
    case "mst":
      // Build phase: accepted edges join the tree. Cut phase (later in the
      // same trace): the k-1 heaviest are removed again, so the FINAL state
      // after full playback shows exactly the kept forest -- "build, then
      // snip into zones" as one continuous reveal.
      if (s.kind === "edge_accept") v.mstEdges.add(ekey(num(p, "u"), num(p, "v")))
      else if (s.kind === "cut") v.mstEdges.delete(ekey(num(p, "u"), num(p, "v")))
      break
    case "bellman":
      if (s.kind === "done") v.bfNegativeCycle = Boolean(p.negative_cycle)
      break
    case "floyd":
      if (s.kind === "k_phase") v.apspK = num(p, "k")
      break
    case "knapsack":
      if (s.kind === "row_start") v.dpRow = num(p, "i")
      else if (s.kind === "cell_take" || s.kind === "cell_best")
        v.dpCells.set(`${num(p, "t")},${num(p, "c")}`, num(p, "value"))
      break
    case "sim":
      if (s.kind === "vehicle_start") { v.vehicle = num(p, "vehicle"); v.clock = 0 }
      else if (s.kind === "pickup") {
        v.vehicle = num(p, "vehicle"); v.clock = num(p, "clock")
        v.at.set(num(p, "vehicle"), num(p, "node")); v.pickedUp.add(num(p, "order"))
      } else if (s.kind === "drop" || s.kind === "deadline_miss") {
        v.vehicle = num(p, "vehicle"); v.clock = num(p, "clock")
        v.at.set(num(p, "vehicle"), num(p, "node")); v.dropped.add(num(p, "order"))
        if (s.kind === "deadline_miss") v.late.add(num(p, "order"))
      } else if (s.kind === "vehicle_end") v.clock = num(p, "clock")
      break
  }
  v.log.push({ stage: s.stage, kind: s.kind, text: describe(s) })
  if (v.log.length > LOG_MAX) v.log.shift()
}

/** Snapshots so an arbitrary scrub replays at most CHECKPOINT_EVERY steps. */
export function buildCheckpoints(trace: Step[]): ViewState[] {
  const cps = [emptyView()]
  const v = emptyView()
  for (let i = 0; i < trace.length; i++) {
    apply(v, trace[i])
    if ((i + 1) % CHECKPOINT_EVERY === 0) cps.push(clone(v))
  }
  return cps
}

export function foldTrace(trace: Step[], cursor: number, cps: ViewState[]): ViewState {
  const idx = Math.min(Math.floor(cursor / CHECKPOINT_EVERY), cps.length - 1)
  const v = clone(cps[idx])
  for (let i = idx * CHECKPOINT_EVERY; i < cursor; i++) apply(v, trace[i])
  return v
}
