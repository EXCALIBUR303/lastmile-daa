import { Loader2, Play } from "lucide-react"
import { useState } from "react"
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from "recharts"
import { runBench } from "../../api"
import { moneyShort, ms } from "../../lib/format"
import { surface, text as textToken, VEHICLE_COLORS } from "../../lib/tokens"
import type { BenchExperiment, BenchRow } from "../../types"
import { Segmented } from "../ui/Field"

const EXPERIMENTS: readonly BenchExperiment[] = [
  "apsp_crossover", "size", "capacity", "selector_quality", "zoning_quality",
]

const META: Record<BenchExperiment, { label: string; question: string; note: string }> = {
  apsp_crossover: {
    label: "Runtime by density",
    question: "Which all-pairs strategy wins as the graph gets denser?",
    note: "Floyd-Warshall is O(n³) regardless of edge count, so its line stays flat while Johnson's climbs with density and can cross above it.",
  },
  size: {
    label: "Runtime by size",
    question: "How does end-to-end solve time scale with the number of nodes?",
    note: "Mean over seeds of the full pipeline: metric closure, zoning, selection, sequencing, simulation and repair.",
  },
  capacity: {
    label: "Capacity sensitivity",
    question: "How much profit does extra vehicle capacity actually buy?",
    note: "Mean achieved profit as the capacity constraint is relaxed. Flattening means capacity has stopped being the binding constraint.",
  },
  selector_quality: {
    label: "Solution quality",
    question: "Which order-selection strategy needs the least repair?",
    note: "Repair drops are the honest differentiator: since the repair loop removes every deadline miss before returning, on-time% saturates at 100% for all selectors. Deadline-blind DP-01 needs the most fixing.",
  },
  zoning_quality: {
    label: "Algorithm comparison",
    question: "Is MST zoning better than ignoring geography?",
    note: "Mean fleet travel time for Prim and Kruskal zoning against the round-robin baseline. Lower is better.",
  },
}

// Kept small so the panel stays interactive; bench/run_bench.py uses fuller
// sweeps for the report-grade figures.
const FAST_PARAMS: Record<BenchExperiment, Record<string, unknown>> = {
  apsp_crossover: { node_counts: [80], densities: [0.05, 0.15, 0.3, 0.5, 0.7] },
  selector_quality: { n_orders_list: [6, 12, 20, 28], seeds: [1, 2, 3] },
  zoning_quality: { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  size: { node_counts: [20, 40, 60, 80, 100], seeds: [1, 2] },
  capacity: { capacities: [4, 8, 12, 16, 20, 25, 30], seeds: [1, 2] },
}

/** Mean of `valueKey` for each distinct `groupKey`, as chart-ready rows. */
function meanBy(rows: BenchRow[], groupKey: string, valueKey: string) {
  const acc = new Map<string, [number, number]>()
  for (const r of rows) {
    const k = String(r[groupKey])
    const [s, n] = acc.get(k) ?? [0, 0]
    acc.set(k, [s + Number(r[valueKey]), n + 1])
  }
  return [...acc.entries()]
    .map(([k, [s, n]]) => ({ key: k, value: s / n }))
    .sort((a, b) => Number(a.key) - Number(b.key))
}

// ---- shared recharts theming ---- //
const AXIS = { stroke: textToken.faint, fontSize: 11, tickLine: false } as const
const GRID = { stroke: surface.line, strokeDasharray: "2 4" } as const
const TOOLTIP_STYLE = {
  contentStyle: {
    background: surface.raised,
    border: `1px solid ${surface.line}`,
    borderRadius: 6,
    fontSize: 11,
    padding: "6px 8px",
  },
  labelStyle: { color: textToken.ink, marginBottom: 2, fontSize: 11 },
  itemStyle: { color: textToken.muted, fontSize: 11 },
} as const
const LEGEND_STYLE = { fontSize: 11, paddingTop: 4 } as const

/** Recharts hands formatters a `ValueType | undefined`; narrow it once here
 *  rather than casting at five call sites. */
const tip = (f: (n: number) => string) => (value: unknown): string =>
  typeof value === "number" ? f(value) : String(value ?? "—")

function axisLabel(value: string, angle: 0 | -90) {
  return {
    value,
    angle,
    position: angle === 0 ? ("insideBottom" as const) : ("insideLeft" as const),
    offset: angle === 0 ? -4 : 10,
    style: { fill: textToken.faint, fontSize: 10, textAnchor: "middle" as const },
  }
}

const CHART_H = 210

function ApspChart({ rows }: { rows: BenchRow[] }) {
  const modes = ["dijkstra", "floyd", "johnson"] as const
  const densities = [...new Set(rows.map((r) => Number(r.density)))].sort((a, b) => a - b)
  const data = densities.map((d) => {
    const point: Record<string, number> = { density: d }
    for (const m of modes) {
      const match = rows.filter((r) => r.mode === m && Number(r.density) === d)
      if (match.length) point[m] = match.reduce((s, r) => s + Number(r.runtime_ms), 0) / match.length
    }
    return point
  })
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 18, left: 2 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="density" {...AXIS} label={axisLabel("edge density", 0)} />
        <YAxis {...AXIS} width={42} label={axisLabel("runtime (ms)", -90)} />
        <RTooltip {...TOOLTIP_STYLE} formatter={tip(ms)} />
        <Legend {...{ wrapperStyle: LEGEND_STYLE }} />
        {modes.map((m, i) => (
          <Line key={m} type="monotone" dataKey={m} name={m} stroke={VEHICLE_COLORS[i]}
                strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function SizeChart({ rows }: { rows: BenchRow[] }) {
  const data = meanBy(rows, "n_nodes", "runtime_ms").map((d) => ({ nodes: Number(d.key), runtime: d.value }))
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 18, left: 2 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="nodes" {...AXIS} label={axisLabel("nodes in graph", 0)} />
        <YAxis {...AXIS} width={42} label={axisLabel("runtime (ms)", -90)} />
        <RTooltip {...TOOLTIP_STYLE} formatter={tip(ms)}
                  labelFormatter={(l) => `${l} nodes`} />
        <Legend {...{ wrapperStyle: LEGEND_STYLE }} />
        <Line type="monotone" dataKey="runtime" name="end-to-end solve" stroke={VEHICLE_COLORS[0]}
              strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function CapacityChart({ rows }: { rows: BenchRow[] }) {
  const data = meanBy(rows, "capacity", "profit").map((d) => ({ capacity: Number(d.key), profit: d.value }))
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 18, left: 2 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="capacity" {...AXIS} label={axisLabel("vehicle capacity (units)", 0)} />
        <YAxis {...AXIS} width={42} tickFormatter={moneyShort} label={axisLabel("profit (units)", -90)} />
        <RTooltip {...TOOLTIP_STYLE} formatter={tip(moneyShort)}
                  labelFormatter={(l) => `capacity ${l}`} />
        <Legend {...{ wrapperStyle: LEGEND_STYLE }} />
        <Line type="monotone" dataKey="profit" name="mean profit achieved" stroke={VEHICLE_COLORS[3]}
              strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function SelectorChart({ rows }: { rows: BenchRow[] }) {
  const selectors = ["dp_deadline", "dp_01", "greedy_edd", "greedy_density"]
  const buckets = [...new Set(rows.map((r) => Number(r.n_orders)))].sort((a, b) => a - b)
  const data = buckets.map((n) => {
    const point: Record<string, number | string> = { n_orders: n }
    for (const sel of selectors) {
      const match = rows.filter((r) => r.selector === sel && Number(r.n_orders) === n)
      if (match.length) point[sel] = match.reduce((s, r) => s + Number(r.repair_drops), 0) / match.length
    }
    return point
  })
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 18, left: 2 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="n_orders" {...AXIS} label={axisLabel("orders in instance", 0)} />
        <YAxis {...AXIS} width={42} label={axisLabel("repair drops", -90)} />
        <RTooltip {...TOOLTIP_STYLE} formatter={tip((v) => v.toFixed(2))}
                  labelFormatter={(l) => `${l} orders`} />
        <Legend {...{ wrapperStyle: LEGEND_STYLE }} />
        {selectors.map((sel, i) => (
          <Bar key={sel} dataKey={sel} name={sel.replace(/_/g, " ")}
               fill={VEHICLE_COLORS[i]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function ZoningChart({ rows }: { rows: BenchRow[] }) {
  const order = ["prim", "kruskal", "none"]
  const means = meanBy(rows, "zoning", "total_travel_time")
  const data = order.map((z) => ({
    zoning: z === "none" ? "round-robin" : z,
    travel: means.find((m) => m.key === z)?.value ?? 0,
  }))
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 18, left: 2 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="zoning" {...AXIS} label={axisLabel("zoning strategy", 0)} />
        <YAxis {...AXIS} width={42} label={axisLabel("travel (min)", -90)} />
        <RTooltip {...TOOLTIP_STYLE} formatter={tip((v) => `${v.toFixed(1)} min`)} />
        <Legend {...{ wrapperStyle: LEGEND_STYLE }} />
        <Bar dataKey="travel" name="mean fleet travel time" fill={VEHICLE_COLORS[2]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

const CHART_FOR: Record<BenchExperiment, (p: { rows: BenchRow[] }) => React.ReactElement> = {
  apsp_crossover: ApspChart,
  size: SizeChart,
  capacity: CapacityChart,
  selector_quality: SelectorChart,
  zoning_quality: ZoningChart,
}

export function ExperimentsPanel() {
  const [experiment, setExperiment] = useState<BenchExperiment>("apsp_crossover")
  const [rows, setRows] = useState<BenchRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runtimeMs, setRuntimeMs] = useState(0)

  const run = async (exp: BenchExperiment) => {
    setExperiment(exp)
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await runBench(exp, FAST_PARAMS[exp])
      setRows(res.rows)
      setRuntimeMs(res.runtime_ms)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRows(null)
    } finally {
      setLoading(false)
    }
  }

  const meta = META[experiment]
  const Chart = CHART_FOR[experiment]

  return (
    <div className="space-y-3">
      <Segmented
        id="bench-exp"
        label="Benchmark experiment"
        options={EXPERIMENTS}
        value={experiment}
        onChange={(e) => void run(e)}
        columns={2}
        describe={(e) => META[e].question}
      />

      <div>
        <h4 className="text-[12px] font-semibold text-ink">{meta.label}</h4>
        <p className="mt-0.5 text-[11px] leading-snug text-muted">{meta.question}</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10" role="status">
          <Loader2 size={14} className="animate-spin text-accent" aria-hidden />
          <span className="text-[11px] text-muted">Running sweep…</span>
        </div>
      )}

      {error && !loading && (
        <div role="alert" className="rounded border border-bad/40 bg-bad/10 px-2.5 py-2 text-[11px] text-bad">
          {error}
        </div>
      )}

      {!loading && !error && !rows && (
        <button
          type="button"
          onClick={() => void run(experiment)}
          className="flex w-full items-center justify-center gap-2 rounded border border-line bg-raised px-3 py-6
                     text-[11px] text-muted transition-colors hover:border-accent hover:text-accent
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Play size={13} aria-hidden />
          Run this experiment
        </button>
      )}

      {!loading && !error && rows && (
        <>
          <Chart rows={rows} />
          <p className="text-[10px] leading-relaxed text-faint">{meta.note}</p>
          <p className="mono border-t border-line pt-2 text-[10px] text-faint">
            {rows.length} rows · {ms(runtimeMs)} · full sweep offline: python -m bench.run_bench
          </p>
        </>
      )}
    </div>
  )
}
