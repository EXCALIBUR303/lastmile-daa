import { AlertTriangle, RefreshCw, Shuffle } from "lucide-react"
import type { GenerateRequest, SolveConfig, Topology } from "../../types"
import { NumberField, Segmented } from "../ui/Field"
import { FieldLabel, Section } from "../ui/Section"
import { SimulationControls } from "./SimulationControls"

const TOPOLOGIES: readonly Topology[] = ["radial", "grid", "scale_free"]
const APSP_MODES: readonly SolveConfig["apsp"][] = ["dijkstra", "floyd", "johnson"]
const ZONING_MODES: readonly SolveConfig["zoning"][] = ["prim", "kruskal", "none"]
const DP_SELECTORS: readonly SolveConfig["selector"][] = ["dp_deadline", "dp_01"]
const GREEDY_SELECTORS: readonly SolveConfig["selector"][] = ["greedy_edd", "greedy_density"]
const SEQUENCERS: readonly SolveConfig["sequencer"][] = ["auto", "held_karp", "insertion_2opt"]

// Each option's "when is this valid / what does it cost" note. These used to be
// permanent paragraphs under every control, which is most of what made the old
// panel unreadable; as tooltips they are one hover or focus away instead.
const APSP_NOTE: Record<SolveConfig["apsp"], string> = {
  dijkstra: "Targeted SSSP: one Dijkstra run per stop node. Cheapest when stops ≪ nodes. Requires non-negative travel times (they always are — τ is time, not cost).",
  floyd: "Floyd-Warshall, full n×n×n sweep. Runtime depends only on n, never on edge count, so it wins on dense graphs. Fills the Matrix view.",
  johnson: "Bellman-Ford potentials, then Dijkstra from every node. Handles negative edge costs and beats Floyd-Warshall on sparse graphs. Fills the Matrix view.",
}
const ZONING_NOTE: Record<SolveConfig["zoning"], string> = {
  prim: "Prim's MST over the pickup stops, then cut the k−1 heaviest edges into one zone per vehicle (single-linkage clustering).",
  kruskal: "Same clustering as Prim but built edge-first with union-find. Same tree weight, different build order to watch in the trace.",
  none: "Baseline: round-robin assignment that ignores geography. Use it to show what MST zoning is actually buying.",
}
const SELECTOR_NOTE: Record<SolveConfig["selector"], string> = {
  dp_deadline: "DP-3: knapsack over capacity AND a discretised time axis, so deadlines are respected during selection. Fills the DP view.",
  dp_01: "Classic 0/1 knapsack on capacity alone — deliberately deadline-blind, so the repair loop has to clean up after it.",
  greedy_density: "G1: highest profit-per-minute first, each candidate checked for EDD feasibility before it is accepted.",
  greedy_edd: "G2: earliest deadline first, with capacity and deadline checked as the route is built.",
}
const SEQUENCER_NOTE: Record<SolveConfig["sequencer"], string> = {
  auto: "Held-Karp while the zone is within the exact-solver cap, cheapest-insertion + 2-opt beyond it.",
  held_karp: "Exact pickup-and-delivery TSP by bitmask DP. Falls back automatically past the 12-stop safety cap, since 2ⁿ·n² stops being tractable.",
  insertion_2opt: "Cheapest-insertion construction, improved by precedence-preserving 2-opt swaps.",
}

export function ControlInspector({
  gen, setGen, cfg, setCfg, disabled, onRun,
}: {
  gen: GenerateRequest
  setGen: (p: Partial<GenerateRequest>) => void
  cfg: SolveConfig
  setCfg: (p: Partial<SolveConfig>) => void
  disabled: boolean
  onRun: () => void
}) {
  const nodesNeeded = gen.n_orders * 2 + 1
  const tooFewNodes = nodesNeeded > gen.n_nodes

  return (
    <div className={disabled ? "pointer-events-none opacity-55" : ""}>
      <Section id="dataset" title="Dataset & topology"
               hint="The synthetic road network and the demand placed on it. Changing anything here needs a new Run.">
        <div className="space-y-2">
          <FieldLabel hint="Radial rings around a centre, a lattice grid, or a preferential-attachment scale-free network.">
            Topology
          </FieldLabel>
          <Segmented id="topology" label="Graph topology" options={TOPOLOGIES}
                     value={gen.topology} onChange={(t) => setGen({ topology: t })} />
        </div>

        <NumberField label="Seed" value={gen.seed} min={1} max={999}
                     hint="Fixes the generator's RNG. The same seed and parameters always produce the same instance."
                     onChange={(v) => setGen({ seed: v })} />
        <NumberField label="Nodes" value={gen.n_nodes} min={12} max={140}
                     onChange={(v) => setGen({ n_nodes: v })} />
        <NumberField label="Density" value={gen.density} min={0.02} max={0.8} step={0.02}
                     hint="Target edge density. Higher density favours Floyd-Warshall over Johnson — see the APSP crossover experiment."
                     onChange={(v) => setGen({ density: v })} />
        <NumberField label="Subsidised edges" value={gen.neg_cost_frac} min={0} max={0.4} step={0.02}
                     hint="Fraction of roads given a negative cost in one direction. This is what makes Bellman-Ford necessary rather than decorative."
                     onChange={(v) => setGen({ neg_cost_frac: v })} />

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setGen({ seed: 1 + Math.floor(Math.random() * 999) })}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded border border-line
                       bg-raised px-2 text-caption text-muted transition-colors hover:border-lineStrong
                       hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
                       md:min-h-[32px]"
          >
            <Shuffle size={12} aria-hidden /> Random seed
          </button>
          <button
            type="button"
            onClick={onRun}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded border border-line
                       bg-raised px-2 text-caption text-muted transition-colors hover:border-lineStrong
                       hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
                       md:min-h-[32px]"
          >
            <RefreshCw size={12} aria-hidden /> Regenerate
          </button>
        </div>

        {tooFewNodes && (
          <p role="alert" className="flex items-start gap-1.5 rounded border border-bad/40 bg-bad/10 px-2 py-1.5
                                     text-caption leading-snug text-bad">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            <span>Need at least {nodesNeeded} nodes to place {gen.n_orders} orders. Raise Nodes or lower Orders.</span>
          </p>
        )}
      </Section>

      <Section id="shortestPaths" title="Shortest paths"
               hint="How the solver builds the stop-to-stop distance metric every later stage depends on.">
        <Segmented id="apsp" label="Shortest path strategy" options={APSP_MODES}
                   value={cfg.apsp} onChange={(m) => setCfg({ apsp: m })}
                   describe={(m) => APSP_NOTE[m]} />
        <p className="text-caption leading-snug text-faint">
          Bellman-Ford always runs alongside these to screen the cost model for negative cycles.
        </p>
      </Section>

      <Section id="backbone" title="Backbone / MST"
               hint="A minimum spanning tree over the pickups, cut into one contiguous zone per vehicle.">
        <Segmented id="zoning" label="Vehicle zoning strategy" options={ZONING_MODES}
                   value={cfg.zoning} onChange={(z) => setCfg({ zoning: z })}
                   describe={(z) => ZONING_NOTE[z]} />
      </Section>

      <Section id="selection" title="Order selection"
               hint="Which orders each vehicle commits to, given its capacity and the deadlines.">
        <div className="space-y-2">
          <FieldLabel hint="Exact dynamic programming over the knapsack-style selection.">
            Dynamic programming
          </FieldLabel>
          <Segmented id="selector-dp" label="Dynamic programming selector" options={DP_SELECTORS}
                     value={cfg.selector} onChange={(s) => setCfg({ selector: s })}
                     describe={(s) => SELECTOR_NOTE[s]} />
        </div>
        <div className="space-y-2">
          <FieldLabel hint="Heuristic baselines to compare the DP against.">Greedy heuristics</FieldLabel>
          <Segmented id="selector-greedy" label="Greedy selector" options={GREEDY_SELECTORS}
                     value={cfg.selector} onChange={(s) => setCfg({ selector: s })}
                     describe={(s) => SELECTOR_NOTE[s]} />
        </div>
        <p className="text-caption leading-snug text-faint">
          One selector is active at a time; the highlighted pill above shows which.
        </p>
      </Section>

      <Section id="sequencing" title="Route sequencing"
               hint="The order stops are visited in, once selection has fixed which orders a vehicle carries.">
        <Segmented id="sequencer" label="Route sequencing strategy" options={SEQUENCERS}
                   value={cfg.sequencer} onChange={(s) => setCfg({ sequencer: s })}
                   describe={(s) => SEQUENCER_NOTE[s]} columns={3} />
      </Section>

      <Section id="fleet" title="Fleet & demand">
        <NumberField label="Orders" value={gen.n_orders} min={2} max={40}
                     onChange={(v) => setGen({ n_orders: v })} />
        <NumberField label="Vehicles" value={gen.n_vehicles} min={1} max={5}
                     onChange={(v) => setGen({ n_vehicles: v })} />
        <NumberField label="Capacity" value={gen.capacity} min={2} max={30}
                     hint="Units each vehicle can hold at once. The binding constraint in the knapsack selection."
                     onChange={(v) => setGen({ capacity: v })} />
        <NumberField label="Shift horizon" value={gen.horizon} min={120} max={900} step={30} suffix="min"
                     hint="Length of the working shift. Deadlines are drawn inside it, and a route that overruns it is infeasible."
                     onChange={(v) => setGen({ horizon: v })} />
      </Section>

      <Section id="simulation" title="Simulation"
               hint="Replays the recorded algorithm trace step by step. It does not re-run the solver.">
        <SimulationControls />
      </Section>
    </div>
  )
}
