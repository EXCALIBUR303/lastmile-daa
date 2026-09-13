import { MotionConfig, motion } from "motion/react"
import { useEffect, useMemo, useState } from "react"
import { ApspMatrix } from "./components/ApspMatrix"
import { CanvasStage } from "./components/CanvasStage"
import { LeftPanel, SegButton } from "./components/Controls"
import { BenchPanel } from "./components/BenchPanel"
import { DpTable } from "./components/DpTable"
import { EventLog, MetricsDock } from "./components/MetricsDock"
import { Transport, usePlaybackClock } from "./components/Transport"
import { spring } from "./motion/presets"
import { useInstance } from "./store/instance"
import { usePlayback } from "./store/playback"
import { useSolution } from "./store/solution"
import { buildCheckpoints, emptyView, foldTrace } from "./trace/reducer"

const RIGHT_TABS = ["trace", "matrix", "dp", "bench"] as const
type RightTab = (typeof RIGHT_TABS)[number]

export default function App() {
  const { gen, cfg, setGen, setCfg } = useInstance()
  const { data, loading, error, run } = useSolution()
  const [rightTab, setRightTab] = useState<RightTab>("trace")
  const cursor = usePlayback((s) => s.cursor)
  const total = usePlayback((s) => s.total)

  usePlaybackClock()

  // first run on mount
  useEffect(() => { void run(gen, cfg) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const trace = data?.trace ?? []
  const checkpoints = useMemo(() => buildCheckpoints(trace), [trace])
  const view = useMemo(
    () => (trace.length ? foldTrace(trace, cursor, checkpoints) : emptyView()),
    [trace, cursor, checkpoints],
  )

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col bg-bg text-ink">
        {/* ---- top bar */}
        <header className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2.5">
          <div>
            <h1 className="text-[13px] font-semibold">Last-mile Delivery with Deadlines</h1>
            <p className="text-[11px] text-muted">DAA PBL · Group 7 · graphs + greedy + DP</p>
          </div>

          {data && !data.stub && (
            <span className="rounded-md bg-good/15 px-2 py-1 text-[11px] text-good">
              Steps 1–7 live: real graph → MST zoning → DP selection → Held-Karp/2-opt routing → repair
            </span>
          )}
          {error && (
            <span className="rounded-md bg-bad/15 px-2 py-1 text-[11px] text-bad">{error}</span>
          )}

          <div className="tabular ml-auto flex items-center gap-4 text-[11px] text-muted">
            {data && (
              <>
                <span>n={String(data.instance.meta.n)}</span>
                <span>m={String(data.instance.meta.m)}</span>
                <span>deg={String(data.instance.meta.avg_degree)}</span>
                <span className="text-warn">{String(data.instance.meta.negative_cost_edges)} subsidised</span>
                <span>{total} steps{data.truncated ? ` (stride ${data.stride})` : ""}</span>
              </>
            )}
          </div>

          <motion.button
            onClick={() => void run(gen, cfg)} disabled={loading}
            whileTap={{ scale: 0.96 }} transition={spring}
            className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-bg disabled:opacity-40"
          >
            {loading ? "Solving…" : "Run"}
          </motion.button>
        </header>

        {/* ---- body */}
        <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_330px]">
          <aside className="overflow-y-auto border-r border-line bg-panel p-4">
            <LeftPanel gen={gen} setGen={setGen} cfg={cfg} setCfg={setCfg} disabled={loading} />
          </aside>

          <main className="relative min-w-0 bg-bg">
            {data
              ? <CanvasStage inst={data.instance} plans={data.result.plans}
                             view={view} showRoutes={cursor > 0} />
              : <div className="flex h-full items-center justify-center text-muted">
                  {loading ? "generating…" : "no instance"}
                </div>}
            {data && (
              <div className="tabular pointer-events-none absolute left-4 top-4 rounded-md bg-panel/80 px-3 py-1.5 text-[12px] backdrop-blur">
                clock <span className="text-accent">{view.clock.toFixed(1)}</span> min
                {view.late.size > 0 && <span className="ml-3 text-bad">{view.late.size} late</span>}
              </div>
            )}
          </main>

          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel p-4">
            {data && (
              <>
                <MetricsDock metrics={data.result.metrics} plans={data.result.plans}
                             capacity={gen.capacity} />
                <div className="min-h-0">
                  <SegButton id="right-tab" options={RIGHT_TABS} value={rightTab}
                             onChange={setRightTab} />
                  <div className="mt-2">
                    {rightTab === "trace" && <EventLog view={view} />}
                    {rightTab === "matrix" && <ApspMatrix apsp={data.apsp} k={view.apspK} />}
                    {rightTab === "dp" && (
                      <DpTable dpRow={view.dpRow} dpCells={view.dpCells}
                               T={Math.ceil(gen.horizon)} Q={gen.capacity}
                               totalOrders={gen.n_orders} />
                    )}
                    {rightTab === "bench" && <BenchPanel />}
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>

        <Transport />
      </div>
    </MotionConfig>
  )
}
