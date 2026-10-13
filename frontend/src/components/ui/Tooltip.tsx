import { useId, useRef, useState } from "react"

/**
 * Hover *and* focus triggered, so the content is reachable from the keyboard
 * rather than being mouse-only. Never used as the sole carrier of essential
 * information -- it explains an abbreviation or a caveat, it does not hide a
 * value the operator needs.
 */
export function Tooltip({
  content, children, side = "top", className = "",
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: "top" | "bottom" | "right"
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)

  const pos =
    side === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-2"
      : side === "bottom"
        ? "top-full left-1/2 -translate-x-1/2 mt-2"
        : "left-full top-1/2 -translate-y-1/2 ml-2"

  return (
    <span
      ref={ref}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        // WCAG 1.4.13: dismissible without moving the pointer or focus.
        if (e.key === "Escape" && open) { setOpen(false); e.stopPropagation() }
      }}
    >
      {/* flex-1 so a tooltip-wrapped control still fills the cell it was placed
          in; without it a wrapped segmented option shrinks to its text width. */}
      <span aria-describedby={open ? id : undefined} className="inline-flex min-w-0 flex-1">
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute ${pos} z-50 w-max max-w-[240px] rounded-md border border-line
                      bg-raised px-2.5 py-1.5 text-body leading-snug text-ink shadow-pop`}
        >
          {content}
        </span>
      )}
    </span>
  )
}

/**
 * The "what does this abbreviation mean" affordance beside KPI labels.
 * The button itself is the touch target (44px on phones, collapsing to the
 * glyph on pointer screens); the small ring is drawn by the inner span, so
 * growing the target never grows the dot.
 */
export function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip content={children}>
      <button
        type="button"
        aria-label={`What is ${label}?`}
        className="group -m-3 flex h-11 w-11 items-center justify-center p-3 md:-m-0 md:h-4 md:w-4 md:p-0
                   focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1
                   focus-visible:outline-accent"
      >
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full border border-line text-caption
                     font-semibold text-faint transition-colors group-hover:border-accent group-hover:text-accent"
          aria-hidden
        >
          ?
        </span>
      </button>
    </Tooltip>
  )
}
