import { AnimatePresence, motion } from "motion/react"
import { ChevronRight, Info } from "lucide-react"
import { dur, ease } from "../../motion/presets"
import { useUi } from "../../store/ui"
import { Tooltip } from "./Tooltip"

/**
 * A labelled disclosure group in the control inspector. Collapsing is how the
 * panel stays scannable without any control being deleted -- everything is one
 * click from visible.
 */
export function Section({
  id, title, hint, badge, children,
}: {
  id: string
  title: string
  hint?: React.ReactNode
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const open = useUi((s) => s.openSections[id] ?? true)
  const toggle = useUi((s) => s.toggleSection)
  const panelId = `section-${id}`

  return (
    <section className="border-b border-line/70 last:border-b-0">
      <h3>
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={open}
          aria-controls={panelId}
          className="group flex min-h-[44px] w-full items-center gap-2 px-4 py-2.5 text-left transition-colors md:min-h-0
                     hover:bg-raised/70 focus-visible:outline focus-visible:-outline-offset-2
                     focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="text-body font-semibold text-ink">{title}</span>
          {hint && (
            <Tooltip content={hint}>
              <Info size={12} className="text-faint" aria-hidden />
            </Tooltip>
          )}
          {/* Collapsed sections still say what they are set to. */}
          {badge && !open && <span className="ml-auto min-w-0 truncate text-caption text-faint">{badge}</span>}
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: dur.fast, ease: ease.out }}
                       className={`${badge && !open ? "" : "ml-auto"} shrink-0 text-faint group-hover:text-muted`}>
            <ChevronRight size={13} aria-hidden />
          </motion.span>
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.base, ease: ease.out }}
          >
            <div className="space-y-3 px-4 pb-4 pt-0.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** Sub-label inside a section, for the individual control groups. */
export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-caption font-medium text-muted">{children}</span>
      {hint && (
        <Tooltip content={hint}>
          <Info size={11} className="cursor-help text-faint" aria-hidden />
        </Tooltip>
      )}
    </div>
  )
}
