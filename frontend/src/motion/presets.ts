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
