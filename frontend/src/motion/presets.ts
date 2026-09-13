import type { Variants } from "motion/react"
import { status } from "../lib/tokens"

export const spring = { type: "spring", stiffness: 420, damping: 32, mass: 0.8 } as const
export const softSpring = { type: "spring", stiffness: 180, damping: 24 } as const
export const easeOutExpo = [0.22, 1, 0.36, 1] as const

// Route/series colours live in lib/tokens.ts; re-exported here so existing
// motion-side imports keep working without a second palette definition.
export { VEHICLE_COLORS, vehicleColor } from "../lib/tokens"

// Named explicitly rather than derived via `keyof typeof nodeVariants`:
// Variants carries a string index signature, and TypeScript's `keyof` on an
// index signature resolves to `string | number` (a real, documented quirk),
// not the narrow literal union callers actually want.
export type NodeVariantName = "idle" | "frontier" | "settled" | "active" | "violated"

// Typed as Variants (not `as const`): `violated.x` needs a mutable keyframe
// array, which `as const` would freeze into a readonly tuple Motion's own
// types reject. This only surfaced under `tsc -b`'s stricter composite build
// (a real production-build blocker), never under plain `tsc --noEmit`.
export const nodeVariants: Record<NodeVariantName, Variants[string]> = {
  idle:     { scale: 1,    filter: "drop-shadow(0 0 0px transparent)" },
  frontier: { scale: 1.22, filter: `drop-shadow(0 0 9px ${status.accent})` },
  settled:  { scale: 1.08, filter: `drop-shadow(0 0 4px ${status.good})` },
  active:   { scale: 1.35, filter: `drop-shadow(0 0 12px ${status.warn})` },
  violated: {
    scale: 1.15, filter: `drop-shadow(0 0 12px ${status.bad})`,
    x: [0, -3, 3, -2, 2, 0], transition: { x: { duration: 0.32 } },
  },
}
