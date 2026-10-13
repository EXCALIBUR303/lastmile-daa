import { motion } from "motion/react"
import { useId, useState } from "react"
import { spring } from "../../motion/presets"
import { Tooltip } from "./Tooltip"

/** Mutually exclusive choice. Rendered as a real radiogroup for assistive tech. */
export function Segmented<T extends string>({
  id, options, value, onChange, label, describe, disabled = false, columns,
}: {
  id: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  /** Accessible name for the group. */
  label: string
  /** Per-option tooltip text, e.g. when an option is valid. */
  describe?: (option: T) => React.ReactNode
  disabled?: boolean
  /** Force a grid instead of a single row when labels are long. */
  columns?: number
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`grid gap-1 rounded-md bg-canvas p-1 ${disabled ? "pointer-events-none opacity-40" : ""}`}
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = value === option
        const button = (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`relative w-full min-h-[44px] rounded px-2 py-1.5 text-caption font-medium transition-colors
                        focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2
                        focus-visible:outline-accent md:min-h-[30px]
                        ${active ? "text-canvas" : "text-muted hover:text-ink"}`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={spring}
                className="absolute inset-0 rounded bg-accent"
              />
            )}
            <span className="relative z-10 block truncate">{option.replace(/_/g, " ")}</span>
          </button>
        )
        return describe ? (
          <Tooltip key={option} content={describe(option)} side="bottom" className="w-full">
            {button}
          </Tooltip>
        ) : (
          button
        )
      })}
    </div>
  )
}

/**
 * Bounded value with a slider for exploration plus a numeric box for the exact
 * figure -- seeds and capacities are values people reproduce, not just sweep.
 */
export function NumberField({
  label, value, min, max, step = 1, suffix = "", onChange, hint, disabled = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (v: number) => void
  hint?: React.ReactNode
  disabled?: boolean
}) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  const [lastValue, setLastValue] = useState(value)

  // Resync the text box when the value changes from elsewhere (slider, random
  // seed, reset) without fighting the user mid-type. Adjusted during render
  // rather than in an effect, so there is no extra commit to paint over.
  if (lastValue !== value) {
    setLastValue(value)
    setDraft(String(value))
  }

  const commit = (raw: string) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return setDraft(String(value))
    const clamped = Math.min(max, Math.max(min, n))
    const snapped = Math.round(clamped / step) * step
    const fixed = Number(snapped.toFixed(4))
    setDraft(String(fixed))
    if (fixed !== value) onChange(fixed)
  }

  return (
    <div className={disabled ? "pointer-events-none opacity-40" : ""}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-caption font-medium text-muted">{label}</label>
        {hint && (
          <Tooltip content={hint}>
            <span className="cursor-help text-caption text-faint">?</span>
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-1">
          <input
            id={`${id}-num`}
            type="number"
            inputMode="decimal"
            value={draft}
            min={min}
            max={max}
            step={step}
            aria-label={`${label} value`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value) }}
            className="mono min-h-[44px] w-16 rounded border border-line bg-canvas px-1.5 py-0.5 text-right
                       text-body text-ink [appearance:textfield] focus-visible:border-accent
                       focus-visible:outline-none md:min-h-0 md:w-14
                       [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {suffix && <span className="text-caption text-faint">{suffix}</span>}
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full"
      />
    </div>
  )
}

/** Icon-only control. Always carries an accessible name and a tooltip. */
export function IconButton({
  label, onClick, children, disabled = false, active = false, tone = "default", size = "md",
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  active?: boolean
  tone?: "default" | "primary"
  size?: "sm" | "md"
}) {
  // Touch-sized below the tablet breakpoint, compact on pointer-driven screens.
  const dim = size === "sm" ? "h-11 w-11 md:h-7 md:w-7" : "h-11 w-11 md:h-8 md:w-8"
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active || undefined}
        className={`${dim} flex items-center justify-center rounded border transition-colors
                    focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1
                    focus-visible:outline-accent disabled:opacity-30
                    ${tone === "primary"
                      ? "border-accent bg-accent text-canvas hover:bg-accent/85"
                      : active
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-line bg-raised text-muted hover:border-lineStrong hover:text-ink"}`}
      >
        {children}
      </button>
    </Tooltip>
  )
}
