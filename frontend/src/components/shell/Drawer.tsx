import { AnimatePresence, motion } from "motion/react"
import { X } from "lucide-react"
import { useEffect, useRef } from "react"

/**
 * Slide-over used for the control and result inspectors below the desktop
 * breakpoint. Side sheet on tablet, bottom sheet on mobile -- in both cases
 * the graph stays mounted underneath rather than being replaced.
 */
export function Drawer({
  open, onClose, title, side, children,
}: {
  open: boolean
  onClose: () => void
  title: string
  side: "left" | "right" | "bottom"
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Escape closes; focus moves into the sheet so the keyboard follows the eye.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    ref.current?.focus()
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const geometry =
    side === "bottom"
      ? { className: "inset-x-0 bottom-0 max-h-[76%] rounded-t-lg border-t", axis: { y: "100%" } }
      : side === "left"
        ? { className: "inset-y-0 left-0 w-[320px] max-w-[86%] border-r", axis: { x: "-100%" } }
        : { className: "inset-y-0 right-0 w-[360px] max-w-[90%] border-l", axis: { x: "100%" } }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 z-30 bg-canvas/55"
            aria-hidden
          />
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="false"
            aria-label={title}
            initial={geometry.axis}
            animate={{ x: 0, y: 0 }}
            exit={geometry.axis}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className={`absolute z-40 flex flex-col border-line bg-panel outline-none ${geometry.className}`}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
              <h2 className="text-body font-semibold text-ink">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={`Close ${title}`}
                className="flex h-11 w-11 items-center justify-center rounded text-muted transition-colors md:h-8 md:w-8
                           hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X size={15} aria-hidden />
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
