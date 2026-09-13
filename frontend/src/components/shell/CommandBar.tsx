import {
  AlertTriangle, CheckCircle2, Loader2, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Play, SlidersHorizontal, BarChart3,
} from "lucide-react"
import { count } from "../../lib/format"
import { useUi } from "../../store/ui"
import type { Instance } from "../../types"
import { IconButton } from "../ui/Field"
import { Tooltip } from "../ui/Tooltip"

/** The fixed pipeline every run walks, shown so the stages stay legible. */
const PIPELINE = ["Graph", "Shortest paths", "MST", "Greedy/DP", "Sequencing"] as const

function Stat({
  label, value, tone = "text-ink", secondary = false,
}: {
  label: string; value: string; tone?: string
  /** Secondary stats are dropped below the desktop breakpoint, so the title
   *  and the Run action never have to give up room for them. */
  secondary?: boolean
}) {
  return (
    <div className={`items-baseline gap-1 whitespace-nowrap ${secondary ? "hidden xl:flex" : "flex"}`}>
      <span className="text-[10px] uppercase tracking-wide text-faint">{label}</span>
      <span className={`mono text-[11px] ${tone}`}>{value}</span>
    </div>
  )
}

export function CommandBar({
  instance, seed, loading, error, alertCount, onRun, layout,
}: {
  instance: Instance | null
  seed: number
  loading: boolean
  error: string | null
  alertCount: number
  onRun: () => void
  layout: "mobile" | "tablet" | "desktop"
}) {
  const { leftOpen, rightOpen, toggleLeft, toggleRight, mobilePane, setMobilePane } = useUi()
  const meta = instance?.meta

  // On a phone the words are dropped and the chip keeps only its icon plus the
  // count; the full wording stays available as the accessible name.
  const terse = layout === "mobile"
  const chipText = (full: string, short: string) => (terse ? short : full)

  const statusChip = error ? (
    <span role="status" aria-label="Solve failed"
          className="flex shrink-0 items-center gap-1.5 rounded border border-bad/40 bg-bad/10 px-2 py-1 text-[11px] text-bad">
      <AlertTriangle size={12} aria-hidden />
      {!terse && <span className="max-w-[220px] truncate">Solve failed</span>}
    </span>
  ) : loading ? (
    <span role="status" aria-label="Solving"
          className="flex shrink-0 items-center gap-1.5 rounded border border-line bg-raised px-2 py-1 text-[11px] text-muted">
      <Loader2 size={12} className="animate-spin" aria-hidden />
      {!terse && "Solving"}
    </span>
  ) : instance ? (
    <span
      role="status"
      aria-label={alertCount > 0 ? `${count(alertCount)} alerts to review` : "Solved, no alerts"}
      className={`flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
        alertCount > 0
          ? "border-warn/35 bg-warn/10 text-warn"
          : "border-good/30 bg-good/10 text-good"
      }`}
    >
      {alertCount > 0 ? <AlertTriangle size={12} aria-hidden /> : <CheckCircle2 size={12} aria-hidden />}
      {alertCount > 0 ? chipText(`${count(alertCount)} to review`, String(alertCount)) : chipText("Solved", "")}
    </span>
  ) : null

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-3 py-2">
      {/* ---- identity. Allowed to shrink and truncate: if this block refuses
           to give up width, it pushes Run off the edge on a narrow phone. */}
      <div className="min-w-0 flex-1 md:flex-none md:shrink-0">
        <h1 className="truncate text-[13px] font-semibold leading-tight text-ink">
          Last-mile Delivery with Deadlines
        </h1>
        <p className="mono truncate text-[10px] leading-tight text-faint">DAA · Group 7 · Topic 2</p>
      </div>

      {/* ---- pipeline, desktop only: it is orientation, not a control */}
      {layout === "desktop" && (
        <ol className="flex shrink-0 items-center gap-1.5 rounded border border-line bg-raised px-2 py-1"
            aria-label="Solver pipeline">
          {PIPELINE.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-faint" aria-hidden>→</span>}
              <span className="whitespace-nowrap text-[10px] text-muted">{s}</span>
            </li>
          ))}
        </ol>
      )}

      {/* ---- dataset summary: the numbers that identify this instance */}
      {meta && layout !== "mobile" && (
        <div className="flex min-w-0 shrink items-center gap-3 overflow-hidden">
          <Stat label="seed" value={String(seed)} />
          <Stat label="n" value={count(Number(meta.n))} />
          <Stat label="m" value={count(Number(meta.m))} />
          <Stat label="deg" value={String(meta.avg_degree)} secondary />
          <Stat label="orders" value={count(instance!.orders.length)} secondary />
          <Stat label="fleet" value={count(instance!.vehicles.length)} secondary />
          {Number(meta.negative_cost_edges) > 0 && (
            <Tooltip content="Roads given a negative cost in one direction. These are why Bellman-Ford is part of the pipeline.">
              <Stat label="subsidised" value={count(Number(meta.negative_cost_edges))} tone="text-warn" secondary />
            </Tooltip>
          )}
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {statusChip}

        {/* mobile / tablet drawer switches */}
        {layout !== "desktop" && (
          <>
            <IconButton
              label="Controls"
              active={mobilePane === "controls"}
              onClick={() => setMobilePane(mobilePane === "controls" ? "none" : "controls")}
            >
              <SlidersHorizontal size={15} aria-hidden />
            </IconButton>
            <IconButton
              label="Results"
              active={mobilePane === "results"}
              onClick={() => setMobilePane(mobilePane === "results" ? "none" : "results")}
            >
              <BarChart3 size={15} aria-hidden />
            </IconButton>
          </>
        )}

        {/* desktop panel collapse */}
        {layout === "desktop" && (
          <>
            <IconButton label={leftOpen ? "Hide controls panel" : "Show controls panel"} onClick={toggleLeft}>
              {leftOpen ? <PanelLeftClose size={15} aria-hidden /> : <PanelLeftOpen size={15} aria-hidden />}
            </IconButton>
            <IconButton label={rightOpen ? "Hide results panel" : "Show results panel"} onClick={toggleRight}>
              {rightOpen ? <PanelRightClose size={15} aria-hidden /> : <PanelRightOpen size={15} aria-hidden />}
            </IconButton>
          </>
        )}

        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          aria-busy={loading}
          className="flex min-h-[44px] items-center gap-1.5 rounded bg-accent px-3 text-[12px] font-semibold md:min-h-[32px]
                     text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed
                     disabled:opacity-40 focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {loading
            ? <Loader2 size={13} className="animate-spin" aria-hidden />
            : <Play size={13} aria-hidden />}
          {loading ? "Solving…" : "Run"}
        </button>
      </div>
    </header>
  )
}
