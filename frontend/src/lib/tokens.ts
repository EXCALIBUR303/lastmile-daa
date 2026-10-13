// Single source of truth for every colour the app draws with.
//
// DOM elements use the Tailwind utilities generated from index.css's @theme
// block (text-good, bg-panel, ...), which re-point automatically per theme.
// These objects exist for the two places a utility class cannot reach: SVG
// paint attributes and 2D canvas fillStyle. Components that paint should call
// `useTokens()` so they follow the active theme; the hex values here mirror
// index.css -- change both together.

import { useUi } from "../store/ui"

export type ThemeName = "dark" | "light"

export interface Palette {
  surface: { canvas: string; panel: string; raised: string; line: string; lineStrong: string }
  text: { ink: string; muted: string; faint: string }
  status: { accent: string; good: string; warn: string; bad: string; violet: string }
  /** Route colours: identify a vehicle on the canvas and nothing else. */
  vehicles: readonly string[]
  /** Benchmark chart series. Okabe-Ito-derived, so the four stay mutually
   *  distinguishable under deuteranopia, protanopia and tritanopia
   *  (minimum CIELAB distance 11+; the route palette dropped to 2.5). */
  series: readonly string[]
  nodeFill: { depot: string; pickup: string; drop: string; junction: string }
  edgeStroke: { network: string; subsidised: string; relaxed: string; mst: string; selected: string }
  /** Hue/lightness inputs for the APSP and DP heatmaps. */
  heat: { apspHue: number; dpHue: number; lightFrom: number; lightTo: number; empty: string }
}

// Greys are chosen by measured contrast against the darkest/lightest surface
// they sit on; every text colour clears 4.5:1 in both themes.
const dark: Palette = {
  surface: { canvas: "#0a0e15", panel: "#111725", raised: "#18202f", line: "#232d40", lineStrong: "#31405a" },
  text: { ink: "#e8eefa", muted: "#93a1bb", faint: "#7b8aa6" },
  status: { accent: "#5ad1ff", good: "#3ddc97", warn: "#ffc857", bad: "#ff6b6b", violet: "#c084fc" },
  vehicles: ["#5ad1ff", "#c084fc", "#3ddc97", "#ffc857", "#ff8fab"],
  series: ["#56b4e9", "#e69f00", "#009e73", "#cc79a7"],
  nodeFill: { depot: "#ffc857", pickup: "#5ad1ff", drop: "#c084fc", junction: "#5b7099" },
  edgeStroke: { network: "#2b3b57", subsidised: "#ffc857", relaxed: "#5ad1ff", mst: "#3ddc97", selected: "#ffffff" },
  heat: { apspHue: 198, dpHue: 268, lightFrom: 14, lightTo: 54, empty: "#161e2c" },
}

// Light is not an inversion: saturated neon reads as glare on white, so the
// accents are darkened until each clears AA on the panel surface, and the heat
// ramps run bright->dark instead of dark->bright.
const light: Palette = {
  surface: { canvas: "#eef1f6", panel: "#ffffff", raised: "#f4f7fa", line: "#d8dfe9", lineStrong: "#b4bfd0" },
  text: { ink: "#0f1722", muted: "#525f76", faint: "#5e6a82" },
  status: { accent: "#0b6f94", good: "#0a7350", warn: "#8a5200", bad: "#b3261e", violet: "#6d28d9" },
  vehicles: ["#0b6f94", "#6d28d9", "#0a7350", "#8a5200", "#a81b52"],
  series: ["#0072b2", "#b85c00", "#00725a", "#a0467f"],
  nodeFill: { depot: "#b26a00", pickup: "#0b6f94", drop: "#6d28d9", junction: "#7a879c" },
  edgeStroke: { network: "#c3ccda", subsidised: "#b26a00", relaxed: "#0b6f94", mst: "#0a7350", selected: "#0f1722" },
  heat: { apspHue: 198, dpHue: 268, lightFrom: 92, lightTo: 38, empty: "#eaeef4" },
}

export const PALETTES: Record<ThemeName, Palette> = { dark, light }

/** Palette for the active theme. Use in anything that paints SVG or canvas. */
export function useTokens(): Palette {
  return PALETTES[useUi((s) => s.theme)]
}

export const vehicleColorFor = (p: Palette, i: number) => p.vehicles[i % p.vehicles.length]

/** Per-stage accent for the trace log and status readout. */
export function stageColorFor(p: Palette, stage: string): string {
  const map: Record<string, string> = {
    build: p.text.muted,
    dijkstra: p.status.good,
    bellman: p.status.good,
    floyd: p.status.accent,
    johnson: p.status.accent,
    mst: p.status.good,
    knapsack: p.status.violet,
    heldkarp: p.status.violet,
    twoopt: p.status.violet,
    sim: p.status.accent,
    repair: p.status.warn,
  }
  return map[stage] ?? p.text.muted
}

// ---- Static dark-palette aliases, kept for non-themed callers (motion
// keyframe filters, which are baked once at module load). ----
export const surface = dark.surface
export const text = dark.text
export const status = dark.status
export const VEHICLE_COLORS = dark.vehicles
export const vehicleColor = (i: number) => dark.vehicles[i % dark.vehicles.length]
