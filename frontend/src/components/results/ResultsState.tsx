import { Loader2 } from "lucide-react"
import { Notice } from "../ui/Notice"
import { LoadingHint } from "../ui/LoadingHint"

/** Shapes of the Summary tab (tab bar, KPI grid, an alert), so the real
 *  content lands where the placeholder was. */
function Skeleton() {
  return (
    <div role="status" aria-label="Solving" className="space-y-4 p-3">
      <div className="flex items-center gap-2 text-caption text-muted">
        <Loader2 size={13} className="animate-spin text-accent" aria-hidden />
        Solving…
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 motion-safe:animate-pulse" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-2.5 w-16 rounded bg-raised" />
            <div className="h-5 w-24 rounded bg-raised" />
            <div className="h-2.5 w-20 rounded bg-raised" />
          </div>
        ))}
      </div>
      <div className="h-16 rounded bg-raised motion-safe:animate-pulse" aria-hidden />
      <LoadingHint>Taking longer than usual. The server may be starting up; the solve will still finish.</LoadingHint>
    </div>
  )
}

/** What the Results panel shows whenever there is no solution to inspect. */
export function ResultsState({
  loading, error, onRun,
}: {
  loading: boolean
  error: string | null
  onRun: () => void
}) {
  if (loading) return <Skeleton />
  // The canvas carries the alert (message + retry); repeating a second alert
  // here would announce the failure twice, so this is a quiet pointer.
  if (error) {
    return (
      <div className="p-3">
        <Notice tone="neutral" title="No results" action="Run again" onAction={onRun}>
          The last run did not complete, so there is nothing to inspect yet.
        </Notice>
      </div>
    )
  }
  return (
    <div className="p-3">
      <Notice tone="neutral" title="No results yet" action="Run" onAction={onRun}>
        Solve an instance to see profit, routes and the algorithm traces here.
      </Notice>
    </div>
  )
}
