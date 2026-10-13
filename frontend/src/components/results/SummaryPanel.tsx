import { motion } from "motion/react"
import { count, minutes, money, ms, percent, ratioPercent } from "../../lib/format"
import { dur, ease } from "../../motion/presets"
import type { Metrics, VehiclePlan } from "../../types"
import { Hint } from "../ui/Tooltip"
import { collectAlerts } from "../../lib/alerts"
import { AlertList } from "./AlertsPanel"

type Tone = "ink" | "good" | "warn" | "bad"
const TONE_CLASS: Record<Tone, string> = {
  ink: "text-ink", good: "text-good", warn: "text-warn", bad: "text-bad",
}

/**
 * One KPI as an aligned label/value pair rather than a card. Colour is a
 * secondary cue only -- every value that can be "bad" also carries a word or
 * a comparison in its sub-line.
 */
function Kpi({
  label, unit, value, tone = "ink", sub, hint, wide = false,
}: {
  label: string
  unit?: string
  value: string
  tone?: Tone
  sub?: React.ReactNode
  hint?: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={`border-b border-line/70 py-2 ${wide ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-1">
        <span className="text-caption text-muted">{label}</span>
        {unit && <span className="text-caption text-faint">({unit})</span>}
        {hint && <Hint label={label}>{hint}</Hint>}
      </div>
      <motion.div
        key={value}
        initial={{ opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: dur.fast, ease: ease.out }}
        className={`mono text-display font-semibold leading-tight ${TONE_CLASS[tone]}`}
      >
        {value}
      </motion.div>
      {sub && <div className="mt-0.5 text-caption leading-snug text-faint">{sub}</div>}
    </div>
  )
}

export function SummaryPanel({
  metrics, plans, ordersTotal,
}: {
  metrics: Metrics
  plans: VehiclePlan[]
  ordersTotal: number
}) {
  const onTimeTone: Tone =
    metrics.on_time_pct >= 90 ? "good" : metrics.on_time_pct >= 60 ? "warn" : "bad"
  const netTone: Tone = metrics.net_profit >= 0 ? "good" : "bad"
  const servedPct = ordersTotal > 0 ? (metrics.orders_served / ordersTotal) * 100 : 0
  const alerts = collectAlerts(metrics, plans)

  return (
    <div className="space-y-4">
      <section aria-label="Key results">
        <div className="grid grid-cols-2 gap-x-4">
          <Kpi
            label="Gross profit" unit="units" value={money(metrics.total_profit)} tone="good"
            sub={`from ${count(metrics.orders_served)} delivered orders`}
            hint="Sum of the profit of every order actually delivered on this plan."
          />
          <Kpi
            label="Total cost" unit="units" value={money(metrics.total_cost)}
            sub="travel cost across all routes"
            hint="Monetary cost of the roads driven. Separate from travel time — subsidised roads can cost less than they take."
          />
          <Kpi
            label="Net profit" unit="units" value={money(metrics.net_profit)} tone={netTone}
            sub={metrics.net_profit >= 0 ? "profit exceeds cost" : "cost exceeds profit"}
            hint="Gross profit minus total cost. Routing optimises travel time, not this figure, so it can be negative on subsidy-heavy instances."
          />
          <Kpi
            label="Orders served" value={`${count(metrics.orders_served)} / ${count(ordersTotal)}`}
            sub={`${percent(servedPct)} of demand accepted`}
            hint="Orders the selection stage committed to and the simulation actually completed."
          />
          <Kpi
            label="On time" unit="%" value={percent(metrics.on_time_pct)} tone={onTimeTone}
            sub={metrics.on_time_pct === 100
              ? "no deadline misses remain"
              : `${count(Math.round((100 - metrics.on_time_pct) / 100 * metrics.orders_served))} late`}
            hint="Share of delivered orders that met their deadline. The repair loop drops offenders before returning, so a healthy run reads 100%."
          />
          <Kpi
            label="Travel time" unit="min" value={minutes(metrics.total_travel_time)}
            sub="summed over the fleet"
            hint="Total driving plus service time across all vehicles."
          />
          <Kpi
            label="Utilisation" unit="%" value={ratioPercent(metrics.avg_utilisation)}
            sub="mean peak load ÷ capacity"
            hint="How full the vehicles get at their fullest point, averaged across the fleet."
          />
          <Kpi
            label="Runtime" unit="ms" value={ms(metrics.runtime_ms)}
            sub="end-to-end solve"
            hint="Wall-clock time for the whole pipeline: metric closure, zoning, selection, sequencing, simulation and repair."
          />
          <Kpi
            wide
            label="DP upper bound" unit="units"
            value={metrics.dp_bound != null ? money(metrics.dp_bound) : "—"}
            sub={metrics.bound_gap_pct != null
              ? `achieved plan is ${percent(metrics.bound_gap_pct)} below this ceiling`
              : "no bound computed for this selector"}
            hint="LP/fractional relaxation of the selection problem: no feasible plan can beat it. The gap is how much of that ceiling this plan captured."
          />
        </div>
      </section>

      <section aria-label="Alerts and feasibility">
        <h4 className="mb-1.5 text-caption font-semibold text-muted">Alerts &amp; feasibility</h4>
        <AlertList alerts={alerts} />
      </section>
    </div>
  )
}
