import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"
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
        return (
          <li key={a.id} className={`rounded border px-2.5 py-2 ${TONE[a.severity]}`}>
            <div className="flex items-start gap-2">
              <Icon size={13} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-caption font-semibold">{a.title}</p>
                <p className="mt-0.5 text-caption leading-relaxed text-muted">{a.detail}</p>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
