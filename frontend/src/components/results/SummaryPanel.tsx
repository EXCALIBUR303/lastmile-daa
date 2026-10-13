import { motion } from "motion/react"
import { count, minutes, money, ms, percent, ratioPercent } from "../../lib/format"
import { dur, ease } from "../../motion/presets"
import type { Metrics, VehiclePlan } from "../../types"
import { Hint } from "../ui/Tooltip"
import { collectAlerts } from "../../lib/alerts"
import { AlertList } from "./AlertsPanel"

type Tone = "ink" | "good" | "warn" | "bad"
const TONE_TEXT: Record<Tone, string> = {
  ink: "text-ink", good: "text-good", warn: "text-warn", bad: "text-bad",
}
const TONE_CARD: Record<Tone, string> = {
  ink: "border-line bg-raised",
  good: "border-good/25 bg-good/[0.06]",
  warn: "border-warn/25 bg-warn/[0.06]",
  bad: "border-bad/25 bg-bad/[0.06]",
}

/** A value that fades in when it changes, so a re-run visibly lands. */
function Value({ value, className }: { value: string; className: string }) {
  return (
    <motion.div
      key={value}
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.fast, ease: ease.out }}
      className={`mono leading-tight ${className}`}
    >
      {value}
    </motion.div>
  )
}

function Label({ label, unit, hint }: { label: string; unit?: string; hint?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-caption text-muted">{label}</span>
      {unit && <span className="text-caption text-faint">({unit})</span>}
      {hint && <Hint label={label}>{hint}</Hint>}
    </div>
  )
}

/** Headline and supporting results: tinted cards, colour backed by words. */
function Card({
  label, unit, value, tone = "ink", sub, hint, big = false, children,
}: {
  label: string; unit?: string; value: string; tone?: Tone
  sub?: React.ReactNode; hint?: React.ReactNode; big?: boolean; children?: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${TONE_CARD[tone]}`}>
      <Label label={label} unit={unit} hint={hint} />
      <Value value={value}
             className={`${big ? "text-hero font-bold" : "text-display font-semibold"} ${TONE_TEXT[tone]}`} />
      {sub && <div className="mt-0.5 text-caption leading-snug text-faint">{sub}</div>}
      {children}
    </div>
  )
}

/** Secondary figures: one aligned row each, label left and number right. */
function Row({
  label, unit, value, sub, hint,
}: { label: string; unit?: string; value: string; sub?: string; hint?: React.ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <Label label={label} unit={unit} hint={hint} />
        {sub && <div className="text-caption leading-snug text-faint">{sub}</div>}
      </div>
      <Value value={value} className="shrink-0 text-right text-title font-medium text-ink" />
    </li>
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
      <section aria-label="Key results" className="space-y-2">
        <Card
          big label="Net profit" unit="units" value={money(metrics.net_profit)} tone={netTone}
          hint="Gross profit minus total cost. Routing optimises travel time, not this figure, so it can be negative on subsidy-heavy instances."
        >
          {/* The headline number explained in one line: where it comes from. */}
          <p className="mono mt-1.5 text-caption text-muted">
            {money(metrics.total_profit)} gross − {money(metrics.total_cost)} cost
          </p>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <Card
            label="Orders served" value={`${count(metrics.orders_served)} / ${count(ordersTotal)}`}
            sub={`${percent(servedPct)} of demand`}
            hint="Orders the selection stage committed to and the simulation actually completed."
          />
          <Card
            label="On time" unit="%" value={percent(metrics.on_time_pct)} tone={onTimeTone}
            sub={metrics.on_time_pct === 100
              ? "no deadline misses"
              : `${count(Math.round((100 - metrics.on_time_pct) / 100 * metrics.orders_served))} late`}
            hint="Share of delivered orders that met their deadline. The repair loop drops offenders before returning, so a healthy run reads 100%."
          />
        </div>
      </section>

      <section aria-labelledby="breakdown-title">
        <h4 id="breakdown-title" className="text-caption font-semibold text-muted">Breakdown</h4>
        <ul className="divide-y divide-line/70">
          <Row label="Gross profit" unit="units" value={money(metrics.total_profit)}
               sub={`from ${count(metrics.orders_served)} delivered orders`}
               hint="Sum of the profit of every order actually delivered on this plan." />
          <Row label="Total cost" unit="units" value={money(metrics.total_cost)}
               sub="travel cost, all routes"
               hint="Monetary cost of the roads driven. Separate from travel time — subsidised roads can cost less than they take." />
          <Row label="Travel time" value={minutes(metrics.total_travel_time)}
               sub="summed over the fleet"
               hint="Total driving plus service time across all vehicles." />
          <Row label="Utilisation" value={ratioPercent(metrics.avg_utilisation)}
               sub="mean peak load ÷ capacity"
               hint="How full the vehicles get at their fullest point, averaged across the fleet." />
          <Row label="DP upper bound" unit="units"
               value={metrics.dp_bound != null ? money(metrics.dp_bound) : "—"}
               sub={metrics.bound_gap_pct != null
                 ? `plan is ${percent(metrics.bound_gap_pct)} below this ceiling`
                 : "no bound for this selector"}
               hint="LP/fractional relaxation of the selection problem: no feasible plan can beat it. The gap is how much of that ceiling this plan captured." />
          <Row label="Runtime" value={ms(metrics.runtime_ms)} sub="end-to-end solve"
               hint="Wall-clock time for the whole pipeline: metric closure, zoning, selection, sequencing, simulation and repair." />
        </ul>
      </section>

      <section aria-label="Alerts and feasibility">
        <h4 className="mb-1.5 text-caption font-semibold text-muted">
          Alerts &amp; feasibility{alerts.length > 0 && ` (${alerts.length})`}
        </h4>
        <AlertList alerts={alerts} />
      </section>
    </div>
  )
}
