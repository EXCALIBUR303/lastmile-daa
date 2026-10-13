import { AlertTriangle, CheckCircle2, ChevronRight, Info, XCircle } from "lucide-react"
import type { Alert } from "../../lib/alerts"

const ICON = { info: Info, warn: AlertTriangle, error: XCircle } as const
const TONE = {
  info: "border-line bg-raised text-muted",
  warn: "border-warn/35 bg-warn/10 text-warn",
  error: "border-bad/40 bg-bad/10 text-bad",
} as const

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded border border-good/30 bg-good/10 px-2.5 py-2">
        <CheckCircle2 size={14} className="shrink-0 text-good" aria-hidden />
        <span className="text-caption text-good">
          All routes feasible, every deadline met, no cost-model warnings.
        </span>
      </div>
    )
  }

  return (
    <ul className="space-y-1.5">
      {alerts.map((a) => {
        const Icon = ICON[a.severity]
        // Errors open by default; the rest are one line until asked for, so
        // three paragraphs of explanation never push the numbers off screen.
        return (
          <li key={a.id}>
            <details open={a.severity === "error"} className={`group rounded border ${TONE[a.severity]}`}>
              <summary className="flex min-h-[44px] cursor-pointer list-none items-start gap-2 px-2.5 py-2 md:min-h-0
                                  focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2
                                  focus-visible:outline-accent">
                <Icon size={13} className="mt-0.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 text-caption font-semibold">{a.title}</span>
                <ChevronRight size={12} className="mt-0.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <p className="px-2.5 pb-2 pl-[30px] text-caption leading-relaxed text-muted">{a.detail}</p>
            </details>
          </li>
        )
      })}
    </ul>
  )
}
