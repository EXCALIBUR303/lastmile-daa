import { AlertTriangle, Info, RotateCw } from "lucide-react"

/**
 * Inline status block for a failed or empty data surface. Errors that need an
 * action stay inline (never a toast) and always carry that action.
 */
export function Notice({
  tone, title, children, action, onAction,
}: {
  tone: "bad" | "neutral"
  title: string
  children: React.ReactNode
  /** Label for the single recovery button; omit when there is nothing to retry. */
  action?: string
  onAction?: () => void
}) {
  const bad = tone === "bad"
  return (
    <div
      role={bad ? "alert" : "status"}
      className={`rounded border px-3 py-3 ${bad ? "border-bad/40 bg-bad/10" : "border-line bg-raised"}`}
    >
      <div className={`flex items-center gap-2 text-body font-semibold ${bad ? "text-bad" : "text-ink"}`}>
        {bad ? <AlertTriangle size={14} aria-hidden /> : <Info size={14} aria-hidden />}
        {title}
      </div>
      <div className="mt-1 text-caption leading-snug text-muted">{children}</div>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-2.5 flex min-h-[44px] items-center gap-1.5 rounded border border-line bg-panel px-3 text-caption
                     font-medium text-ink transition-colors hover:border-accent hover:text-accent md:min-h-[32px]
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <RotateCw size={12} aria-hidden />
          {action}
        </button>
      )}
    </div>
  )
}
