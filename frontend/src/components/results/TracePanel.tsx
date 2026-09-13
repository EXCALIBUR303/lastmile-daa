import { AnimatePresence, motion } from "motion/react"
import { stageColor } from "../../lib/tokens"
import { spring } from "../../motion/presets"
import type { ViewState } from "../../trace/reducer"

const VISIBLE = 18

/** The most recent algorithm events, newest first. */
export function TracePanel({ view, total }: { view: ViewState; total: number }) {
  const recent = view.log.slice(-VISIBLE).reverse()

  if (total === 0) {
    return (
      <p className="rounded border border-line bg-raised/40 px-3 py-6 text-center text-[11px] text-muted">
        No trace recorded. Run a solve with tracing enabled to see each algorithm step here.
      </p>
    )
  }

  if (recent.length === 0) {
    return (
      <p className="rounded border border-line bg-raised/40 px-3 py-6 text-center text-[11px] text-muted">
        Press play in the Simulation section to step through {total.toLocaleString()} recorded events.
      </p>
    )
  }

  return (
    <ol className="space-y-0.5" aria-live="off">
      <AnimatePresence initial={false}>
        {recent.map((e, i) => (
          <motion.li
            key={`${view.log.length - i}-${e.stage}-${e.kind}`}
            layout
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: i === 0 ? 1 : Math.max(0.35, 0.8 - i * 0.03), x: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className={`flex gap-2 rounded px-2 py-1 text-[11px] ${i === 0 ? "bg-raised" : ""}`}
          >
            <span
              className="mono w-16 shrink-0 truncate font-medium"
              style={{ color: e.kind === "deadline_miss" ? "#ff6b6b" : (stageColor[e.stage] ?? "#93a1bb") }}
            >
              {e.stage}
            </span>
            <span className="min-w-0 break-words text-muted">{e.text}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}
