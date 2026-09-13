import { motion } from "motion/react"
import { spring } from "../../motion/presets"

export interface TabDef<T extends string> {
  id: T
  label: string
  /** Optional count/severity chip, e.g. the number of open alerts. */
  badge?: { text: string; tone: "neutral" | "warn" | "bad" }
}

const BADGE_TONE = {
  neutral: "bg-line text-muted",
  warn: "bg-warn/20 text-warn",
  bad: "bg-bad/20 text-bad",
} as const

/** Underline tab bar. Roving state lives with the caller so tab content can be
 *  kept mounted (or not) at the caller's discretion. */
export function Tabs<T extends string>({
  tabs, value, onChange, label,
}: {
  tabs: readonly TabDef<T>[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex border-b border-line">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((t) => t.id === value)
              if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].id)
              if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].id)
            }}
            className={`relative flex min-h-[44px] flex-1 items-center justify-center gap-1.5 px-2 text-[12px]
                        md:min-h-[36px]
                        font-medium transition-colors focus-visible:outline focus-visible:-outline-offset-2
                        focus-visible:outline-2 focus-visible:outline-accent
                        ${active ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            <span className="truncate">{tab.label}</span>
            {tab.badge && (
              <span className={`mono rounded px-1 py-px text-[10px] ${BADGE_TONE[tab.badge.tone]}`}>
                {tab.badge.text}
              </span>
            )}
            {active && (
              <motion.span
                layoutId="tabs-underline"
                transition={spring}
                className="absolute inset-x-0 -bottom-px h-0.5 bg-accent"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
