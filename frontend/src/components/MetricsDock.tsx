import { AnimatePresence, motion } from "motion/react"
import { spring, vehicleColor } from "../motion/presets"
import type { ViewState } from "../trace/reducer"
import type { Metrics, VehiclePlan } from "../types"

function Tile({ label, value, tone = "ink", hint }: {
  label: string; value: string; tone?: "ink" | "good" | "warn" | "bad"; hint?: string
}) {
  const color = { ink: "#e6ecf7", good: "#3ddc97", warn: "#ffc857", bad: "#ff6b6b" }[tone]
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <motion.div key={value} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  transition={spring} className="tabular text-[17px] font-semibold"
                  style={{ color }}>{value}</motion.div>
      {hint && <div className="tabular mt-0.5 text-[10px] text-muted">{hint}</div>}
    </div>
  )
}

export function MetricsDock({ metrics, plans, capacity }: {
  metrics: Metrics; plans: VehiclePlan[]; capacity: number
}) {
  const onTimeTone = metrics.on_time_pct >= 90 ? "good" : metrics.on_time_pct >= 60 ? "warn" : "bad"
  const netTone = metrics.net_profit >= 0 ? "good" : "bad"
  return (
    <div className="space-y-3">
      {metrics.negative_cost_cycle && (
        <div className="rounded-md bg-warn/15 px-2 py-1.5 text-[11px] text-warn">
          ⚠ Cost model has a negative cycle (some chain of subsidies loops net-negative).
          Informational only — routing is chosen by travel time, not cost.
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Profit" value={metrics.total_profit.toFixed(2)} tone="good" />
        <Tile label="On time" value={`${metrics.on_time_pct}%`} tone={onTimeTone}
              hint={`${metrics.orders_served}/${metrics.orders_total} orders`} />
        <Tile label="Net profit" value={metrics.net_profit.toFixed(2)} tone={netTone}
              hint="profit − cost" />
        <Tile label="Cost" value={metrics.total_cost.toFixed(2)} />
        <Tile label="Travel" value={`${metrics.total_travel_time.toFixed(0)} min`} />
        <Tile label="Utilisation" value={`${(metrics.avg_utilisation * 100).toFixed(0)}%`} />
        <Tile label="DP bound" value={metrics.dp_bound?.toFixed(2) ?? "—"}
              hint={metrics.bound_gap_pct != null ? `gap ${metrics.bound_gap_pct}%` : "Step 6"} />
        <Tile label="Runtime" value={`${metrics.runtime_ms.toFixed(2)} ms`} />
      </div>

      <div className="space-y-1.5">
        {plans.map((p) => (
          <div key={p.vehicle_id} className="rounded-lg border border-line bg-bg px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full"
                    style={{ background: vehicleColor(p.vehicle_id) }} />
              <span className="text-[12px] font-medium">Vehicle {p.vehicle_id}</span>
              <span className={`tabular ml-auto text-[11px] ${p.feasible ? "text-good" : "text-bad"}`}>
                {p.feasible ? "feasible" : "infeasible"}
              </span>
            </div>
            <div className="tabular mt-1 flex gap-3 text-[11px] text-muted">
              <span>{p.selected.length} sel</span>
              <span>peak {p.peak_load}/{capacity}</span>
              <span>{p.travel_time.toFixed(0)} min</span>
              <span className="text-good">{p.profit.toFixed(0)}</span>
            </div>
            {p.mst_lower_bound != null && (
              <div className="tabular mt-0.5 text-[10px] text-muted">
                MST bound {p.mst_lower_bound.toFixed(0)} min
                <span className="ml-1 text-warn">
                  (+{(100 * (p.travel_time / p.mst_lower_bound - 1)).toFixed(0)}% over)
                </span>
              </div>
            )}
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
              <motion.div className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (p.peak_load / capacity) * 100)}%` }}
                transition={spring}
                style={{ background: vehicleColor(p.vehicle_id) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const STAGE_TONE: Record<string, string> = {
  sim: "#5ad1ff", build: "#7d8aa3", dijkstra: "#3ddc97",
  mst: "#3ddc97", knapsack: "#c084fc", repair: "#ffc857",
}

export function EventLog({ view }: { view: ViewState }) {
  const recent = view.log.slice(-16).reverse()
  return (
    <div className="space-y-1">
      <AnimatePresence initial={false}>
        {recent.map((e, i) => (
          <motion.div
            key={`${view.log.length - i}-${e.kind}`}
            layout
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: i === 0 ? 1 : 0.55 - i * 0.02, x: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className="flex gap-2 rounded-md px-2 py-1 text-[11px]"
            style={{ background: i === 0 ? "#1e2839" : "transparent" }}
          >
            <span className="tabular shrink-0 font-medium"
                  style={{ color: e.kind === "deadline_miss" ? "#ff6b6b" : STAGE_TONE[e.stage] ?? "#7d8aa3" }}>
              {e.stage}
            </span>
            <span className="text-muted">{e.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
