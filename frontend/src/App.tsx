import { MotionConfig } from "motion/react"
import { useEffect, useMemo } from "react"
import { ControlInspector } from "./components/controls/ControlInspector"
import { SimulationControls } from "./components/controls/SimulationControls"
import { GraphWorkspace } from "./components/graph/GraphWorkspace"
import { collectAlerts } from "./lib/alerts"
import { ResultsInspector } from "./components/results/ResultsInspector"
import { ResultsState } from "./components/results/ResultsState"
import { CommandBar } from "./components/shell/CommandBar"
import { Drawer } from "./components/shell/Drawer"
import { useLayoutMode } from "./lib/useMediaQuery"
import { usePlaybackClock } from "./lib/usePlaybackClock"
import { useInstance } from "./store/instance"
import { usePlayback } from "./store/playback"
import { useSolution } from "./store/solution"
import { useUi } from "./store/ui"
import { buildCheckpoints, emptyView, foldTrace } from "./trace/reducer"
import type { Step } from "./types"

const NO_TRACE: Step[] = []

export default function App() {
  const { gen, cfg, setGen, setCfg } = useInstance()
  const { data, loading, error, run } = useSolution()
  const cursor = usePlayback((s) => s.cursor)
  const total = usePlayback((s) => s.total)
  const layout = useLayoutMode()
  const { leftOpen, rightOpen, mobilePane, setMobilePane, select, focusVehicle } = useUi()

  usePlaybackClock()

  // first run on mount
  useEffect(() => { void run(gen, cfg) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable empty reference: a fresh `[]` each render would re-run the
  // checkpoint build and the fold on every unrelated state change.
  const trace = data?.trace ?? NO_TRACE
  const checkpoints = useMemo(() => buildCheckpoints(trace), [trace])
  const view = useMemo(
    () => (trace.length ? foldTrace(trace, cursor, checkpoints) : emptyView()),
    [trace, cursor, checkpoints],
  )

  // A new solve invalidates anything selected or isolated from the previous one.
  const runSolve = () => {
    select(null)
    focusVehicle(null)
    void run(gen, cfg)
  }

  const stage = cursor > 0 && trace.length ? trace[Math.min(cursor, trace.length) - 1].stage : null
  const alerts = data ? collectAlerts(data.result.metrics, data.result.plans) : []

  const controls = (
    <ControlInspector gen={gen} setGen={setGen} cfg={cfg} setCfg={setCfg}
                      disabled={loading} onRun={runSolve} />
  )

  // While a re-run is in flight the previous result stays visible (dimmed)
  // rather than collapsing to a placeholder; the placeholder is for when there
  // is nothing to show.
  const results = data ? (
    <div aria-busy={loading} className={`flex min-h-0 flex-1 flex-col transition-opacity ${loading ? "opacity-60" : ""}`}>
      <ResultsInspector data={data} view={view} capacity={gen.capacity}
                        horizon={gen.horizon} ordersRequested={gen.n_orders} />
    </div>
  ) : (
    <ResultsState loading={loading} error={error} onRun={runSolve} />
  )

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col overflow-hidden bg-canvas text-ink">
        <CommandBar
          instance={data?.instance ?? null}
          seed={gen.seed}
          loading={loading}
          error={error}
          alertCount={alerts.length}
          onRun={runSolve}
          layout={layout}
        />

        <div className="relative flex min-h-0 flex-1">
          {/* ---- desktop: docked control inspector */}
          {layout === "desktop" && leftOpen && (
            <aside
              aria-label="Controls"
              className="scroll-thin w-[276px] shrink-0 2xl:w-[312px] overflow-y-auto border-r border-line bg-panel"
            >
              {controls}
            </aside>
          )}

          {/* ---- graph is the workspace at every size */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <GraphWorkspace
              inst={data?.instance ?? null}
              plans={data?.result.plans ?? []}
              view={view}
              showRoutes={cursor > 0}
              loading={loading}
              error={error}
              onRun={runSolve}
              stage={stage}
              stepLabel={`${cursor.toLocaleString()}/${total.toLocaleString()}`}
            />
            {/* Below the desktop breakpoint the controls live in a drawer, so
                playback gets a permanent bar here instead -- same component,
                never two live copies. */}
            {layout !== "desktop" && <SimulationControls compact />}
          </div>

          {/* ---- desktop: docked results inspector */}
          {layout === "desktop" && rightOpen && (
            <aside
              aria-label="Results"
              className="flex w-[364px] shrink-0 2xl:w-[420px] flex-col border-l border-line bg-panel"
            >
              {results}
            </aside>
          )}

          {/* ---- tablet & mobile: the same two panels as sheets */}
          {layout !== "desktop" && (
            <>
              <Drawer
                open={mobilePane === "controls"}
                onClose={() => setMobilePane("none")}
                title="Controls"
                side={layout === "mobile" ? "bottom" : "left"}
              >
                {controls}
              </Drawer>
              <Drawer
                open={mobilePane === "results"}
                onClose={() => setMobilePane("none")}
                title="Results"
                side={layout === "mobile" ? "bottom" : "right"}
              >
                <div className="flex min-h-0 flex-1 flex-col">{results}</div>
              </Drawer>
            </>
          )}
        </div>
      </div>
    </MotionConfig>
  )
}
