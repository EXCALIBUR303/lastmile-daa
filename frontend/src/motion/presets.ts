import type { Variants } from "motion/react"

// One vocabulary for every animation in the app. Motion is the only engine;
// everything it drives is transform or opacity (compositor-only), and
// <MotionConfig reducedMotion="user"> in App.tsx strips the transforms for
// people who ask for less motion.

/** Seconds. Feedback is quick, state changes a little slower, never past 300 ms. */
export const dur = { fast: 0.15, base: 0.2, slow: 0.3 } as const

/** Entrances ease out (fast start, soft landing); exits ease in and run shorter. */
export const ease = {
  out: [0.22, 1, 0.36, 1],
  in: [0.4, 0, 1, 1],
} as const

export const spring = { type: "spring", stiffness: 420, damping: 32, mass: 0.8 } as const

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
  idle:     { scale: 1 },
  frontier: { scale: 1.22 },
  settled:  { scale: 1.08 },
  active:   { scale: 1.35 },
  violated: { scale: 1.15, x: [0, -3, 3, -2, 2, 0], transition: { x: { duration: 0.32 } } },
}

/** Opacity of the coloured halo behind a node in each state. Replaces the old
 *  blurred drop-shadow filter, which repainted every node on every change. */
export const HALO_OPACITY: Record<NodeVariantName, number> = {
  idle: 0, frontier: 0.35, settled: 0.25, active: 0.4, violated: 0.4,
}
