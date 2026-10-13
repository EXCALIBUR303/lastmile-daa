import { Loader2, Play, RotateCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from "recharts"
import { runBench } from "../../api"
import { moneyShort, ms } from "../../lib/format"
import { useTokens, type Palette } from "../../lib/tokens"
import type { BenchExperiment, BenchRow } from "../../types"
import { Segmented } from "../ui/Field"
import { LoadingHint } from "../ui/LoadingHint"
import { Notice } from "../ui/Notice"

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

// ---- chart model ---------------------------------------------------------- //
//
// Every experiment is reduced to one ChartSpec, so the plot, the legend, the
// data table and the one-line summary are all generated from the same numbers
// and cannot drift apart.

type Cell = number | string
type Row = Record<string, Cell>
interface Series { key: string; name: string }
interface ChartSpec {
  kind: "line" | "bar"
  xKey: string
  xTitle: string
  yTitle: string
  xTick: (v: Cell) => string
  yTick: (n: number) => string
  /** Full-precision formatting for the tooltip and the table. */
  yValue: (n: number) => string
  tipLabel: (v: Cell) => string
  series: Series[]
  data: Row[]
  summary: string
}

const finite = (n: number) => Number.isFinite(n)
const sortedUnique = (xs: number[]) => [...new Set(xs.filter(finite))].sort((a, b) => a - b)
const average = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const plain = (v: Cell) => String(v)
const msTick = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}s` : String(+n.toFixed(n < 10 ? 1 : 0)))

/** Series ordered by value at one row, for the "fastest / slowest" sentence. */
function extremes(row: Row | undefined, series: Series[]) {
  if (!row) return null
  const vals = series
    .map((s) => ({ name: s.name, v: Number(row[s.key]) }))
    .filter((s) => finite(s.v))
    .sort((a, b) => a.v - b.v)
  return vals.length ? { low: vals[0], high: vals[vals.length - 1], count: vals.length } : null
}

function apspSpec(rows: BenchRow[]): ChartSpec {
  const modes: Series[] = [
    { key: "dijkstra", name: "Dijkstra" },
    { key: "floyd", name: "Floyd-Warshall" },
    { key: "johnson", name: "Johnson" },
  ]
  const data = sortedUnique(rows.map((r) => Number(r.density))).map((d) => {
    const row: Row = { density: d }
    for (const m of modes) {
      const v = average(rows.filter((r) => r.mode === m.key && Number(r.density) === d).map((r) => Number(r.runtime_ms)))
      if (finite(v)) row[m.key] = v
    }
    return row
  })
  const e = extremes(data[data.length - 1], modes)
  return {
    kind: "line", xKey: "density", xTitle: "Edge density (share of possible edges)", yTitle: "Runtime (ms)",
    xTick: (v) => Number(v).toFixed(2), yTick: msTick, yValue: ms, tipLabel: (v) => `density ${Number(v).toFixed(2)}`,
    series: modes, data,
    summary: e && e.count > 1
      ? `At the densest graph, ${e.low.name} is fastest (${ms(e.low.v)}) and ${e.high.name} slowest (${ms(e.high.v)}).`
      : "",
  }
}

function sizeSpec(rows: BenchRow[]): ChartSpec {
  const data = sortedUnique(rows.map((r) => Number(r.n_nodes))).map((n) => ({
    nodes: n,
    runtime: average(rows.filter((r) => Number(r.n_nodes) === n).map((r) => Number(r.runtime_ms))),
  })).filter((d) => finite(d.runtime))
  const first = data[0], last = data[data.length - 1]
  return {
    kind: "line", xKey: "nodes", xTitle: "Nodes in the graph", yTitle: "End-to-end solve time (ms)",
    xTick: plain, yTick: msTick, yValue: ms, tipLabel: (v) => `${v} nodes`,
    series: [{ key: "runtime", name: "End-to-end solve" }], data,
    summary: first && last && first !== last
      ? `Solve time grows from ${ms(first.runtime)} at ${first.nodes} nodes to ${ms(last.runtime)} at ${last.nodes} nodes.`
      : "",
  }
}

function capacitySpec(rows: BenchRow[]): ChartSpec {
  const data = sortedUnique(rows.map((r) => Number(r.capacity))).map((c) => ({
    capacity: c,
    profit: average(rows.filter((r) => Number(r.capacity) === c).map((r) => Number(r.profit))),
  })).filter((d) => finite(d.profit))
  const first = data[0], last = data[data.length - 1], prev = data[data.length - 2]
  let summary = ""
  if (first && last && prev) {
    const lastStep = last.profit - prev.profit
    const flat = Math.abs(lastStep) <= 0.02 * Math.max(1, Math.abs(last.profit))
    summary = `Profit moves from ${moneyShort(first.profit)} at capacity ${first.capacity} to ${moneyShort(last.profit)} at ${last.capacity}`
      + (flat ? "; the last step adds almost nothing, so capacity has stopped binding." : ".")
  }
  return {
    kind: "line", xKey: "capacity", xTitle: "Vehicle capacity (load units)", yTitle: "Mean profit achieved (units)",
    xTick: plain, yTick: (n) => moneyShort(n), yValue: moneyShort, tipLabel: (v) => `capacity ${v}`,
    series: [{ key: "profit", name: "Mean profit achieved" }], data, summary,
  }
}

function selectorSpec(rows: BenchRow[]): ChartSpec {
  const selectors: Series[] = [
    { key: "dp_deadline", name: "DP (deadline)" },
    { key: "dp_01", name: "DP 0/1" },
    { key: "greedy_edd", name: "Greedy EDD" },
    { key: "greedy_density", name: "Greedy density" },
  ]
  const data = sortedUnique(rows.map((r) => Number(r.n_orders))).map((n) => {
    const row: Row = { n_orders: n }
    for (const s of selectors) {
      const v = average(rows.filter((r) => r.selector === s.key && Number(r.n_orders) === n).map((r) => Number(r.repair_drops)))
      if (finite(v)) row[s.key] = v
    }
    return row
  })
  const last = data[data.length - 1]
  const e = extremes(last, selectors)
  return {
    kind: "bar", xKey: "n_orders", xTitle: "Orders in the instance", yTitle: "Orders dropped by the repair loop (mean)",
    xTick: plain, yTick: (n) => String(+n.toFixed(1)), yValue: (n) => n.toFixed(2), tipLabel: (v) => `${v} orders`,
    series: selectors, data,
    summary: e && e.count > 1
      ? `With ${last.n_orders} orders, ${e.low.name} needs the least repair (${e.low.v.toFixed(2)} drops) and ${e.high.name} the most (${e.high.v.toFixed(2)}).`
      : "",
  }
}

function zoningSpec(rows: BenchRow[]): ChartSpec {
  const order = [["prim", "Prim MST"], ["kruskal", "Kruskal MST"], ["none", "Round-robin"]] as const
  const data = order
    .map(([key, name]) => ({
      zoning: name,
      travel: average(rows.filter((r) => r.zoning === key).map((r) => Number(r.total_travel_time))),
    }))
    .filter((d) => finite(d.travel))
  const base = data.find((d) => d.zoning === "Round-robin")
  const best = [...data].sort((a, b) => a.travel - b.travel)[0]
  let summary = ""
  if (best && base && best !== base && base.travel > 0) {
    summary = `${best.zoning} cuts mean fleet travel time by ${(100 * (1 - best.travel / base.travel)).toFixed(0)}% against round-robin (${best.travel.toFixed(1)} vs ${base.travel.toFixed(1)} min).`
  }
  return {
    kind: "bar", xKey: "zoning", xTitle: "Zoning strategy", yTitle: "Mean fleet travel time (min)",
    xTick: plain, yTick: (n) => String(Math.round(n)), yValue: (n) => `${n.toFixed(1)} min`, tipLabel: plain,
    series: [{ key: "travel", name: "Mean fleet travel time" }], data, summary,
  }
}

const SPEC_FOR: Record<BenchExperiment, (rows: BenchRow[]) => ChartSpec> = {
  apsp_crossover: apspSpec,
  size: sizeSpec,
  capacity: capacitySpec,
  selector_quality: selectorSpec,
  zoning_quality: zoningSpec,
}

// ---- encodings beyond colour ------------------------------------------------ //
//
// Colour is never the only carrier: each series also has its own dash pattern
// and marker shape (lines) or fill pattern (bars), so the chart still reads in
// greyscale, under any colour-vision deficiency, and in a bad projector.

const DASH = [undefined, "6 3", "2 3", "8 3 2 3"] as const
const CHART_H = 250
const CHART_FONT = 11
const patternId = (i: number) => `bench-pattern-${i}`

function Marker({ cx, cy, shape, color }: { cx?: number; cy?: number; shape: number; color: string }) {
  if (cx === undefined || cy === undefined) return null
  const r = 4
  switch (shape % 4) {
    case 0: return <circle cx={cx} cy={cy} r={r} fill={color} />
    case 1: return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={color} />
    case 2: return <path d={`M${cx} ${cy - r - 1}L${cx + r + 1} ${cy + r}L${cx - r - 1} ${cy + r}Z`} fill={color} />
    default: return <path d={`M${cx} ${cy - r - 1}L${cx + r + 1} ${cy}L${cx} ${cy + r + 1}L${cx - r - 1} ${cy}Z`} fill={color} />
  }
}

/** Zero-size SVG holding the bar fill patterns, shared by the plot and legend. */
function PatternDefs({ p }: { p: Palette }) {
  const bg = p.surface.panel
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        {p.series.map((c, i) => (
          <pattern key={i} id={patternId(i)} width="6" height="6" patternUnits="userSpaceOnUse"
                   patternTransform={i === 1 ? "rotate(45)" : undefined}>
            <rect width="6" height="6" fill={c} />
            {i === 1 && <line x1="0" y1="3" x2="6" y2="3" stroke={bg} strokeWidth="2" />}
            {i === 2 && <circle cx="3" cy="3" r="1.3" fill={bg} />}
            {i === 3 && <path d="M0 3H6M3 0V6" stroke={bg} strokeWidth="1.2" />}
          </pattern>
        ))}
      </defs>
    </svg>
  )
}

function Swatch({ kind, i, color }: { kind: "line" | "bar"; i: number; color: string }) {
  return (
    <svg width="30" height="12" className="shrink-0" aria-hidden>
      {kind === "line" ? (
        <>
          <line x1="0" y1="6" x2="30" y2="6" stroke={color} strokeWidth="2" strokeDasharray={DASH[i % 4]} />
          <Marker cx={15} cy={6} shape={i} color={color} />
        </>
      ) : (
        <rect x="8" y="1" width="14" height="10" rx="1" fill={`url(#${patternId(i)})`} stroke={color} />
      )}
    </svg>
  )
}

// ---- chart ------------------------------------------------------------------ //

function Chart({ spec }: { spec: ChartSpec }) {
  const p = useTokens()
  const axis = { stroke: p.text.faint, fontSize: CHART_FONT, tickLine: false } as const
  const tooltip = {
    contentStyle: {
      background: p.surface.panel, border: `1px solid ${p.surface.lineStrong}`,
      borderRadius: 6, fontSize: CHART_FONT, padding: "6px 8px",
    },
    labelStyle: { color: p.text.ink, marginBottom: 2, fontSize: CHART_FONT },
    itemStyle: { color: p.text.muted, fontSize: CHART_FONT },
    formatter: (v: unknown) => (typeof v === "number" ? spec.yValue(v) : String(v ?? "—")),
    labelFormatter: (l: unknown) => spec.tipLabel(l as Cell),
  }
  const margin = { top: 8, right: 12, bottom: 2, left: 0 }
  const grid = <CartesianGrid stroke={p.surface.line} strokeDasharray="2 4" vertical={spec.kind === "line"} />
  const xAxis = <XAxis dataKey={spec.xKey} {...axis} tickMargin={6} tickFormatter={spec.xTick} />
  const yAxis = <YAxis {...axis} width={46} tickFormatter={spec.yTick} />

  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      {spec.kind === "line" ? (
        <LineChart data={spec.data} margin={margin}>
          {grid}{xAxis}{yAxis}
          <RTooltip {...tooltip} cursor={{ stroke: p.surface.lineStrong }} />
          {spec.series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={p.series[i]}
                  strokeWidth={2} strokeDasharray={DASH[i % 4]} isAnimationActive={false}
                  dot={(d: { cx?: number; cy?: number; index?: number }) => (
                    <Marker key={d.index} cx={d.cx} cy={d.cy} shape={i} color={p.series[i]} />
                  )}
                  activeDot={{ r: 6, stroke: p.surface.panel, strokeWidth: 2 }} />
          ))}
        </LineChart>
      ) : (
        <BarChart data={spec.data} margin={margin} barCategoryGap="22%">
          {grid}{xAxis}{yAxis}
          <RTooltip {...tooltip} cursor={{ fill: p.surface.raised, opacity: 0.6 }} />
          {spec.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name}
                 fill={spec.series.length > 1 ? `url(#${patternId(i)})` : p.series[2]}
                 stroke={p.series[spec.series.length > 1 ? i : 2]} strokeWidth={1}
                 radius={[2, 2, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}

function DataTable({ spec }: { spec: ChartSpec }) {
  return (
    <details className="group rounded border border-line">
      <summary className="min-h-[44px] cursor-pointer list-none px-2.5 py-2 text-caption text-muted
                          hover:text-ink focus-visible:outline focus-visible:outline-2
                          focus-visible:-outline-offset-2 focus-visible:outline-accent md:min-h-0">
        <span className="group-open:hidden">Show data table</span>
        <span className="hidden group-open:inline">Hide data table</span>
      </summary>
      <div className="scroll-thin overflow-x-auto border-t border-line">
        <table className="mono w-full text-caption">
          <caption className="sr-only">{spec.yTitle} by {spec.xTitle.toLowerCase()}</caption>
          <thead>
            <tr className="text-faint">
              <th scope="col" className="px-2.5 py-1.5 text-left font-medium">{spec.xTitle.split(" (")[0]}</th>
              {spec.series.map((s) => (
                <th key={s.key} scope="col" className="px-2.5 py-1.5 text-right font-medium">{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.data.map((row) => (
              <tr key={String(row[spec.xKey])} className="border-t border-line text-muted">
                <th scope="row" className="px-2.5 py-1 text-left font-normal text-ink">{spec.xTick(row[spec.xKey])}</th>
                {spec.series.map((s) => (
                  <td key={s.key} className="px-2.5 py-1 text-right">
                    {typeof row[s.key] === "number" ? spec.yValue(row[s.key] as number) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// ---- states ----------------------------------------------------------------- //

/** Same footprint as the finished chart, so nothing jumps when it arrives. */
function ChartSkeleton() {
  return (
    <div role="status" className="space-y-2">
      <div className="flex items-center justify-center gap-2 rounded border border-line bg-raised motion-safe:animate-pulse"
           style={{ height: CHART_H }}>
        <Loader2 size={14} className="animate-spin text-accent" aria-hidden />
        <span className="text-caption text-muted">Running sweep…</span>
      </div>
      <LoadingHint>Taking longer than usual. The server may be starting up; the sweep will still finish.</LoadingHint>
    </div>
  )
}

interface Entry { rows: BenchRow[]; runtimeMs: number }

export function ExperimentsPanel() {
  const p = useTokens()
  const [experiment, setExperiment] = useState<BenchExperiment>("apsp_crossover")
  // Results and failures are kept per experiment, so switching tabs is instant
  // and one experiment's rows can never be drawn with another's chart.
  const [done, setDone] = useState<Partial<Record<BenchExperiment, Entry>>>({})
  const [failed, setFailed] = useState<Partial<Record<BenchExperiment, string>>>({})
  const [pending, setPending] = useState<BenchExperiment | null>(null)
  const inflight = useRef<AbortController | null>(null)

  useEffect(() => () => inflight.current?.abort(), [])

  const run = useCallback(async (exp: BenchExperiment) => {
    inflight.current?.abort()
    const ac = new AbortController()
    inflight.current = ac
    setPending(exp)
    setFailed((f) => ({ ...f, [exp]: undefined }))
    try {
      const res = await runBench(exp, FAST_PARAMS[exp], ac.signal)
      if (ac.signal.aborted) return
      setDone((d) => ({ ...d, [exp]: { rows: res.rows, runtimeMs: res.runtime_ms } }))
    } catch (e) {
      if (ac.signal.aborted) return
      setFailed((f) => ({ ...f, [exp]: e instanceof Error ? e.message : String(e) }))
    } finally {
      if (inflight.current === ac) setPending(null)
    }
  }, [])

  const choose = (exp: BenchExperiment) => {
    setExperiment(exp)
    if (!done[exp] && !failed[exp]) void run(exp)
  }

  const meta = META[experiment]
  const entry = done[experiment]
  const error = failed[experiment]
  const spec = entry ? SPEC_FOR[experiment](entry.rows) : null
  const busy = pending !== null

  let body: React.ReactNode
  if (pending === experiment) {
    body = <ChartSkeleton />
  } else if (error) {
    body = (
      <Notice tone="bad" title="Experiment failed" action="Try again" onAction={() => void run(experiment)}>
        {error}
      </Notice>
    )
  } else if (entry && spec && spec.data.length === 0) {
    body = (
      <Notice tone="neutral" title="No data to plot" action="Run again" onAction={() => void run(experiment)}>
        The sweep finished but returned no usable rows ({entry.rows.length} received).
      </Notice>
    )
  } else if (entry && spec) {
    body = (
      <figure className="space-y-1.5" aria-label={`${meta.label}: ${spec.yTitle} by ${spec.xTitle}`}>
        <figcaption className="text-caption text-faint">{spec.yTitle}</figcaption>
        <Chart spec={spec} />
        <p className="text-center text-caption text-faint">{spec.xTitle}</p>

        {spec.series.length > 1 && (
          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 pt-1">
            {spec.series.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1.5 text-caption text-muted">
                <Swatch kind={spec.kind} i={i} color={p.series[i]} />
                {s.name}
              </li>
            ))}
          </ul>
        )}

        {spec.summary && <p className="pt-1 text-body leading-snug text-ink">{spec.summary}</p>}
        <p className="text-caption leading-relaxed text-faint">{meta.note}</p>
        <DataTable spec={spec} />
        <div className="mono flex items-center justify-between gap-2 border-t border-line pt-2 text-caption text-faint">
          <span>{entry.rows.length} rows · {ms(entry.runtimeMs)} · offline: python -m bench.run_bench</span>
          <button
            type="button"
            onClick={() => void run(experiment)}
            disabled={busy}
            className="flex min-h-[44px] shrink-0 items-center gap-1 rounded px-2 text-muted transition-colors
                       hover:text-accent disabled:opacity-40 md:min-h-0 md:px-1
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <RotateCw size={11} aria-hidden /> Re-run
          </button>
        </div>
      </figure>
    )
  } else {
    body = (
      <button
        type="button"
        onClick={() => void run(experiment)}
        className="flex w-full items-center justify-center gap-2 rounded border border-line bg-raised px-3 py-6
                   text-caption text-muted transition-colors hover:border-accent hover:text-accent
                   focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Play size={13} aria-hidden />
        Run this experiment
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <PatternDefs p={p} />
      <Segmented
        id="bench-exp"
        label="Benchmark experiment"
        options={EXPERIMENTS}
        value={experiment}
        onChange={choose}
        disabled={busy}
        columns={2}
        describe={(e) => META[e].question}
      />

      <div>
        <h4 className="text-body font-semibold text-ink">{meta.label}</h4>
        <p className="mt-0.5 text-caption leading-snug text-muted">{meta.question}</p>
      </div>

      {body}
    </div>
  )
}
