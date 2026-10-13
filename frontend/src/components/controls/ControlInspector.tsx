import { AlertTriangle, Shuffle } from "lucide-react"
import type { GenerateRequest, SolveConfig, Topology } from "../../types"
import { NumberField, Segmented } from "../ui/Field"
import { Section } from "../ui/Section"
import { Tooltip } from "../ui/Tooltip"
import { SimulationControls } from "./SimulationControls"

const TOPOLOGIES: readonly Topology[] = ["radial", "grid", "scale_free"]
const APSP_MODES: readonly SolveConfig["apsp"][] = ["dijkstra", "floyd", "johnson"]
const ZONING_MODES: readonly SolveConfig["zoning"][] = ["prim", "kruskal", "none"]
const SELECTORS: readonly SolveConfig["selector"][] = ["dp_deadline", "dp_01", "greedy_edd", "greedy_density"]
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

// Display names. Option ids stay exactly what the API expects.
const LABEL: Record<string, string> = {
  radial: "Radial", grid: "Grid", scale_free: "Scale-free",
  dijkstra: "Dijkstra", floyd: "Floyd", johnson: "Johnson",
  prim: "Prim", kruskal: "Kruskal", none: "None",
  dp_deadline: "DP + deadlines", dp_01: "DP 0/1", greedy_edd: "Greedy EDD", greedy_density: "Greedy density",
  auto: "Auto", held_karp: "Held–Karp", insertion_2opt: "2-opt",
}
const label = (o: string) => LABEL[o] ?? o.replace(/_/g, " ")

/** Small heading that splits the panel into its two jobs. */
function Group({ title, note }: { title: string; note: string }) {
  return (
    <div className="border-b border-line/70 bg-raised/50 px-4 pb-2 pt-3">
      <p className="text-caption font-semibold text-ink">{title}</p>
      <p className="text-caption text-faint">{note}</p>
    </div>
  )
}

export function ControlInspector({
  gen, setGen, cfg, setCfg, disabled,
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
      <Group title="Algorithms" note="Pick one per stage, then Run." />

      <Section id="paths" title="Shortest paths" badge={label(cfg.apsp)}
               hint="How the stop-to-stop distance metric is built. Bellman-Ford always runs alongside to screen the cost model for negative cycles.">
        <Segmented id="apsp" label="Shortest path strategy" options={APSP_MODES} format={label}
                   value={cfg.apsp} onChange={(m) => setCfg({ apsp: m })}
                   describe={(m) => APSP_NOTE[m]} />
      </Section>

      <Section id="zoning" title="Zoning (MST)" badge={label(cfg.zoning)}
               hint="A minimum spanning tree over the pickups, cut into one contiguous zone per vehicle.">
        <Segmented id="zoning" label="Vehicle zoning strategy" options={ZONING_MODES} format={label}
                   value={cfg.zoning} onChange={(z) => setCfg({ zoning: z })}
                   describe={(z) => ZONING_NOTE[z]} />
      </Section>

      <Section id="selection" title="Order selection" badge={label(cfg.selector)}
               hint="Which orders each vehicle commits to, given capacity and deadlines. The two DP options are exact; the two greedy options are baselines to compare against.">
        <Segmented id="selector" label="Order selection strategy" options={SELECTORS} format={label}
                   value={cfg.selector} onChange={(s) => setCfg({ selector: s })}
                   describe={(s) => SELECTOR_NOTE[s]} columns={2} />
      </Section>

      <Section id="sequencing" title="Route order" badge={label(cfg.sequencer)}
               hint="The order stops are visited in, once selection has fixed which orders a vehicle carries.">
        <Segmented id="sequencer" label="Route sequencing strategy" options={SEQUENCERS} format={label}
                   value={cfg.sequencer} onChange={(s) => setCfg({ sequencer: s })}
                   describe={(s) => SEQUENCER_NOTE[s]} />
      </Section>

      <Group title="Problem instance" note="The generated network and its demand." />

      <Section id="network" title="Network"
               badge={`${label(gen.topology)} · ${gen.n_nodes} nodes · seed ${gen.seed}`}
               hint="The synthetic road network: radial rings around a centre, a lattice grid, or a preferential-attachment scale-free graph. Changing anything here needs a new Run.">
        <Segmented id="topology" label="Graph topology" options={TOPOLOGIES} format={label}
                   value={gen.topology} onChange={(t) => setGen({ topology: t })} />
        <NumberField label="Seed" value={gen.seed} min={1} max={999}
                     hint="Fixes the generator's RNG. The same seed and parameters always produce the same instance."
                     onChange={(v) => setGen({ seed: v })}
                     action={
                       <Tooltip content="Random seed">
                         <button
                           type="button"
                           aria-label="Random seed"
                           onClick={() => setGen({ seed: 1 + Math.floor(Math.random() * 999) })}
                           className="flex h-11 w-11 items-center justify-center rounded text-faint transition-colors
                                      hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2
                                      focus-visible:outline-accent md:h-6 md:w-6"
                         >
                           <Shuffle size={12} aria-hidden />
                         </button>
                       </Tooltip>
                     } />
        <NumberField label="Nodes" value={gen.n_nodes} min={12} max={140}
                     onChange={(v) => setGen({ n_nodes: v })} />
        <NumberField label="Density" value={gen.density} min={0.02} max={0.8} step={0.02}
                     hint="Target edge density. Higher density favours Floyd-Warshall over Johnson — see the APSP crossover experiment."
                     onChange={(v) => setGen({ density: v })} />
        <NumberField label="Subsidised edges" value={gen.neg_cost_frac} min={0} max={0.4} step={0.02}
                     hint="Fraction of roads given a negative cost in one direction. This is what makes Bellman-Ford necessary rather than decorative."
                     onChange={(v) => setGen({ neg_cost_frac: v })} />
      </Section>

      <Section id="demand" title="Demand & fleet"
               badge={`${gen.n_orders} orders · ${gen.n_vehicles} vehicles`}>
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

      {/* Shown wherever it is, not only inside a folded section: a config that
          cannot be generated must be impossible to miss. */}
      {tooFewNodes && (
        <p role="alert" className="mx-4 my-3 flex items-start gap-1.5 rounded border border-bad/40 bg-bad/10 px-2 py-1.5
                                   text-caption leading-snug text-bad">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>Need at least {nodesNeeded} nodes to place {gen.n_orders} orders. Raise Nodes or lower Orders.</span>
        </p>
      )}

      <Group title="Playback" note="Replays the recorded trace; it does not re-solve." />
      <div className="px-4 py-3">
        <SimulationControls />
      </div>
    </div>
  )
}
