import { motion } from "motion/react"
import { spring } from "../motion/presets"
import type { GenerateRequest, SolveConfig, Topology } from "../types"

export function Slider({
  label, value, min, max, step = 1, suffix = "", onChange,
}: {
  label: string; value: number; min: number; max: number
  step?: number; suffix?: string; onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
        <span className="tabular text-[12px] text-ink">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </label>
  )
}

export function SegButton<T extends string>({
  id, options, value, onChange,
}: { id: string; options: readonly T[]; value: T; onChange: (v: T) => void }) {
  // `id` namespaces the shared-layout pill: two SegButtons mounted at once
  // (e.g. Topology + APSP mode) must not share one layoutId, or their sliding
  // highlights fight over the same animated element.
  return (
    <div className="flex gap-1 rounded-lg bg-bg p-1">
      {options.map((o) => (
        <button
          key={o} onClick={() => onChange(o)}
          className="relative flex-1 rounded-md px-2 py-1 text-[11px] capitalize transition-colors"
          style={{ color: value === o ? "#0b0f16" : "#7d8aa3" }}
        >
          {value === o && (
            <motion.span layoutId={`seg-${id}`} transition={spring}
              className="absolute inset-0 rounded-md bg-accent" />
          )}
          <span className="relative z-10">{o.replace("_", " ")}</span>
        </button>
      ))}
    </div>
  )
}

const TOPOLOGIES: readonly Topology[] = ["radial", "grid", "scale_free"]
const APSP_MODES: readonly SolveConfig["apsp"][] = ["dijkstra", "floyd", "johnson"]
const ZONING_MODES: readonly SolveConfig["zoning"][] = ["prim", "kruskal", "none"]

export function LeftPanel({
  gen, setGen, cfg, setCfg, disabled,
}: {
  gen: GenerateRequest; setGen: (p: Partial<GenerateRequest>) => void
  cfg: SolveConfig; setCfg: (p: Partial<SolveConfig>) => void
  disabled: boolean
}) {
  return (
    <div className={`space-y-4 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Topology</h3>
        <SegButton id="topology" options={TOPOLOGIES} value={gen.topology}
                   onChange={(t) => setGen({ topology: t })} />
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Algorithms
        </h3>
        <label className="block text-[10px] text-muted">APSP metric closure</label>
        <SegButton id="apsp" options={APSP_MODES} value={cfg.apsp}
                   onChange={(m) => setCfg({ apsp: m })} />
        <p className="text-[10px] leading-snug text-muted">
          {cfg.apsp === "dijkstra" && "Targeted: Dijkstra from each stop node only."}
          {cfg.apsp === "floyd" && "Full n×n sweep, O(n³) — see the matrix tab."}
          {cfg.apsp === "johnson" && "Bellman-Ford potentials + Dijkstra ×n — see the matrix tab."}
        </p>

        <label className="block pt-1 text-[10px] text-muted">Vehicle zoning</label>
        <SegButton id="zoning" options={ZONING_MODES} value={cfg.zoning}
                   onChange={(z) => setCfg({ zoning: z })} />
        <p className="text-[10px] leading-snug text-muted">
          {cfg.zoning === "prim" && "MST (Prim) over pickups, cut into per-vehicle zones."}
          {cfg.zoning === "kruskal" && "MST (Kruskal) over pickups, cut into per-vehicle zones."}
          {cfg.zoning === "none" && "Baseline: round-robin, ignores geography entirely."}
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Graph</h3>
        <Slider label="Seed" value={gen.seed} min={1} max={999}
                onChange={(v) => setGen({ seed: v })} />
        <Slider label="Nodes" value={gen.n_nodes} min={12} max={140}
                onChange={(v) => setGen({ n_nodes: v })} />
        <Slider label="Density" value={gen.density} min={0.02} max={0.8} step={0.02}
                onChange={(v) => setGen({ density: v })} />
        <Slider label="Subsidised edges" value={gen.neg_cost_frac} min={0} max={0.4} step={0.02}
                onChange={(v) => setGen({ neg_cost_frac: v })} />
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Fleet & demand</h3>
        <Slider label="Orders" value={gen.n_orders} min={2} max={40}
                onChange={(v) => setGen({ n_orders: v })} />
        <Slider label="Vehicles" value={gen.n_vehicles} min={1} max={5}
                onChange={(v) => setGen({ n_vehicles: v })} />
        <Slider label="Capacity" value={gen.capacity} min={2} max={30}
                onChange={(v) => setGen({ capacity: v })} />
        <Slider label="Shift horizon" value={gen.horizon} min={120} max={900} step={30}
                suffix=" min" onChange={(v) => setGen({ horizon: v })} />
      </section>

      {gen.n_orders * 2 + 1 > gen.n_nodes && (
        <p className="rounded-md bg-bad/15 px-2 py-1.5 text-[11px] text-bad">
          Need ≥ {gen.n_orders * 2 + 1} nodes for {gen.n_orders} orders.
        </p>
      )}
    </div>
  )
}
