import { motion } from "motion/react"
import { useState } from "react"
import { runBench } from "../api"
import { VEHICLE_COLORS, spring } from "../motion/presets"
import type { BenchExperiment, BenchRow } from "../types"
import { SegButton } from "./Controls"

const EXPERIMENTS: readonly BenchExperiment[] = [
  "apsp_crossover", "selector_quality", "zoning_quality", "size", "capacity",
]
const EXPERIMENT_LABEL: Record<BenchExperiment, string> = {
  apsp_crossover: "APSP crossover", selector_quality: "Selector quality",
  zoning_quality: "MST vs round-robin", size: "Size scaling", capacity: "Capacity",
}
// Small, fast params for an interactive sidebar panel -- run_bench.py (the
// offline script) uses fuller defaults for the report-grade PNGs/CSVs.
const FAST_PARAMS: Record<BenchExperiment, Record<string, unknown>> = {
  apsp_crossover: { node_counts: [80], densities: [0.05, 0.15, 0.3, 0.5, 0.7] },
  selector_quality: { n_orders_list: [6, 12, 20, 28], seeds: [1, 2, 3] },
  zoning_quality: { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  size: { node_counts: [20, 40, 60, 80, 100], seeds: [1, 2] },
  capacity: { capacities: [4, 8, 12, 16, 20, 25, 30], seeds: [1, 2] },
}

function groupMean(rows: BenchRow[], groupKey: string, valueKey: string): [string, number][] {
  const sums = new Map<string, [number, number]>()
  for (const r of rows) {
    const k = String(r[groupKey])
    const v = Number(r[valueKey])
    const [s, n] = sums.get(k) ?? [0, 0]
    sums.set(k, [s + v, n + 1])
  }
  return [...sums.entries()].map(([k, [s, n]]) => [k, s / n])
}

// ---- one small, generic axis-and-frame primitive every chart below reuses ---- //

const W = 300, H = 170, PAD = { l: 34, r: 8, t: 10, b: 22 }

function Frame({ children, xTicks, yMax }: { children: React.ReactNode; xTicks: string[]; yMax: number }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#33415c" />
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="#33415c" />
      <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize={8} fill="#7d8aa3">{yMax.toFixed(0)}</text>
      <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" fontSize={8} fill="#7d8aa3">0</text>
      {xTicks.map((t, i) => (
        <text key={i} x={PAD.l + (i / Math.max(1, xTicks.length - 1)) * (W - PAD.l - PAD.r)}
              y={H - PAD.b + 12} textAnchor="middle" fontSize={8} fill="#7d8aa3">{t}</text>
      ))}
      {children}
    </svg>
  )
}

function LineSeries({ points, color, yMax }: { points: [number, number][]; color: string; yMax: number }) {
  if (points.length === 0) return null
  const xs = points.map((p) => p[0])
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const sx = (x: number) => PAD.l + (xMax > xMin ? (x - xMin) / (xMax - xMin) : 0) * (W - PAD.l - PAD.r)
  const sy = (y: number) => H - PAD.b - (yMax > 0 ? y / yMax : 0) * (H - PAD.t - PAD.b)
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${sx(x)},${sy(y)}`).join(" ")
  return (
    <>
      <motion.path d={d} fill="none" stroke={color} strokeWidth={2}
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5 }} />
      {points.map(([x, y], i) => (
        <circle key={i} cx={sx(x)} cy={sy(y)} r={2.5} fill={color} />
      ))}
    </>
  )
}

function Bars({ groups, series, yMax }: { groups: string[]; series: { label: string; color: string; values: number[] }[]; yMax: number }) {
  const gw = (W - PAD.l - PAD.r) / groups.length
  const bw = gw / (series.length + 1)
  return (
    <>
      {groups.map((_, gi) =>
        series.map((s, si) => {
          const v = s.values[gi] ?? 0
          const h = yMax > 0 ? (v / yMax) * (H - PAD.t - PAD.b) : 0
          const x = PAD.l + gi * gw + (si + 0.5) * bw
          return (
            <motion.rect key={`${gi}-${si}`} x={x - bw / 2.2} width={bw / 1.1} fill={s.color}
                        initial={{ height: 0, y: H - PAD.b }} animate={{ height: h, y: H - PAD.b - h }}
                        transition={spring} />
          )
        }),
      )}
    </>
  )
}

// ---- per-experiment chart bodies ---- //

function ApspCrossoverChart({ rows }: { rows: BenchRow[] }) {
  const modes = ["dijkstra", "floyd", "johnson"] as const
  const densities = [...new Set(rows.map((r) => Number(r.density)))].sort((a, b) => a - b)
  const yMax = Math.max(1, ...rows.map((r) => Number(r.runtime_ms)))
  return (
    <Frame xTicks={densities.map((d) => d.toFixed(2))} yMax={yMax}>
      {modes.map((mode, i) => {
        const pts = rows.filter((r) => r.mode === mode)
          .map((r) => [Number(r.density), Number(r.runtime_ms)] as [number, number])
          .sort((a, b) => a[0] - b[0])
        return <LineSeries key={mode} points={pts} color={VEHICLE_COLORS[i]} yMax={yMax} />
      })}
    </Frame>
  )
}

function SelectorQualityChart({ rows }: { rows: BenchRow[] }) {
  const selectors = ["dp_deadline", "dp_01", "greedy_density", "greedy_edd"]
  const nOrders = [...new Set(rows.map((r) => String(r.n_orders)))].sort((a, b) => Number(a) - Number(b))
  const series = selectors.map((sel, i) => ({
    label: sel, color: VEHICLE_COLORS[i],
    values: nOrders.map((n) => {
      const m = groupMean(rows.filter((r) => r.selector === sel), "n_orders", "repair_drops")
      return m.find(([k]) => k === n)?.[1] ?? 0
    }),
  }))
  const yMax = Math.max(1, ...series.flatMap((s) => s.values))
  return <Frame xTicks={nOrders} yMax={yMax}><Bars groups={nOrders} series={series} yMax={yMax} /></Frame>
}

function ZoningQualityChart({ rows }: { rows: BenchRow[] }) {
  const zonings = ["prim", "kruskal", "none"]
  const means = groupMean(rows, "zoning", "total_travel_time")
  const values = zonings.map((z) => means.find(([k]) => k === z)?.[1] ?? 0)
  const yMax = Math.max(1, ...values)
  const series = [{ label: "travel", color: VEHICLE_COLORS[0], values }]
  return <Frame xTicks={zonings} yMax={yMax}><Bars groups={zonings} series={series} yMax={yMax} /></Frame>
}

function SizeChart({ rows }: { rows: BenchRow[] }) {
  const means = groupMean(rows, "n_nodes", "runtime_ms").sort((a, b) => Number(a[0]) - Number(b[0]))
  const pts = means.map(([k, v]) => [Number(k), v] as [number, number])
  const yMax = Math.max(1, ...pts.map((p) => p[1]))
  return (
    <Frame xTicks={means.map(([k]) => k)} yMax={yMax}>
      <LineSeries points={pts} color={VEHICLE_COLORS[0]} yMax={yMax} />
    </Frame>
  )
}

function CapacityChart({ rows }: { rows: BenchRow[] }) {
  const means = groupMean(rows, "capacity", "profit").sort((a, b) => Number(a[0]) - Number(b[0]))
  const pts = means.map(([k, v]) => [Number(k), v] as [number, number])
  const yMax = Math.max(1, ...pts.map((p) => p[1]))
  return (
    <Frame xTicks={means.map(([k]) => k)} yMax={yMax}>
      <LineSeries points={pts} color={VEHICLE_COLORS[3]} yMax={yMax} />
    </Frame>
  )
}

const CHART_FOR: Record<BenchExperiment, (props: { rows: BenchRow[] }) => React.ReactElement> = {
  apsp_crossover: ApspCrossoverChart, selector_quality: SelectorQualityChart,
  zoning_quality: ZoningQualityChart, size: SizeChart, capacity: CapacityChart,
}
const CAPTION: Record<BenchExperiment, string> = {
  apsp_crossover: "n=80, runtime (ms) vs density — Floyd-Warshall (green) stays flat since O(n³) ignores m; Johnson (purple) grows with density and can cross above it.",
  selector_quality: "mean repair drops needed, by orders/instance — DP-1 (blind, purple) needs the most fixing; DP-3 (blue) the least.",
  zoning_quality: "mean total travel time (min) — MST zoning (prim/kruskal) vs the round-robin baseline (none).",
  size: "mean end-to-end runtime (ms) vs graph size.",
  capacity: "mean achieved profit vs vehicle capacity.",
}

export function BenchPanel() {
  const [experiment, setExperiment] = useState<BenchExperiment>("apsp_crossover")
  const [rows, setRows] = useState<BenchRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runtimeMs, setRuntimeMs] = useState(0)

  const run = async (exp: BenchExperiment) => {
    setExperiment(exp)
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

  const Chart = CHART_FOR[experiment]
  return (
    <div className="space-y-2">
      <SegButton id="bench-exp" options={EXPERIMENTS} value={experiment}
                onChange={(e) => void run(e)} />
      <div className="text-[9px] text-muted">
        {EXPERIMENTS.map((e) => (e === experiment ? EXPERIMENT_LABEL[e] : "")).join("")}
      </div>
      {loading && <div className="py-6 text-center text-[11px] text-muted">running…</div>}
      {error && <div className="rounded-md bg-bad/15 px-2 py-1.5 text-[11px] text-bad">{error}</div>}
      {!loading && !error && rows && (
        <>
          <Chart rows={rows} />
          <p className="text-[9px] leading-snug text-muted">{CAPTION[experiment]}</p>
          <p className="tabular text-[9px] text-muted">
            {rows.length} rows · {runtimeMs.toFixed(0)} ms · full-size offline sweep: `python -m bench.run_bench`
          </p>
        </>
      )}
      {!loading && !error && !rows && (
        <div className="py-6 text-center text-[11px] text-muted">Pick an experiment to run it.</div>
      )}
    </div>
  )
}
