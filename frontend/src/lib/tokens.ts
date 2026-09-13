// Single source of truth for every colour the app draws with.
//
// DOM elements should use the Tailwind utilities generated from index.css's
// @theme block (text-good, bg-panel, ...). These constants exist for the two
// places a utility class cannot reach: SVG paint attributes and 2D canvas
// fillStyle. The hexes in index.css mirror this file -- change both together.

export const surface = {
  canvas: "#0a0e15",
  panel: "#111725",
  raised: "#18202f",
  line: "#232d40",
  lineStrong: "#31405a",
} as const

// Both greys are set by measured contrast against --color-panel (#111725),
// the darkest surface they sit on: muted 6.9:1, faint 5.1:1. The originals
// (#7d8aa3 / #6b7893) measured 4.8:1 and 4.0:1, the latter failing AA for
// the 10-11px captions it was used on.
export const text = {
  ink: "#e8eefa",
  muted: "#93a1bb",
  faint: "#7b8aa6",
} as const

export const status = {
  accent: "#5ad1ff",
  good: "#3ddc97",
  warn: "#ffc857",
  bad: "#ff6b6b",
  violet: "#c084fc",
} as const

/** Route colours. Index by vehicle id; also doubles as the categorical series
 *  palette for benchmark charts so a "vehicle 2" line reads the same hue. */
export const VEHICLE_COLORS = [
  "#5ad1ff", // cyan
  "#c084fc", // violet
  "#3ddc97", // green
  "#ffc857", // amber
  "#ff8fab", // pink
] as const

export const vehicleColor = (i: number) => VEHICLE_COLORS[i % VEHICLE_COLORS.length]

/** Node roles in the delivery network. */
export const nodeFill = {
  depot: "#ffc857",
  pickup: "#5ad1ff",
  drop: "#c084fc",
  junction: "#5b7099",
} as const

/** Edge roles. `network` is the unselected road graph and must stay quiet so
 *  routes, MST links and shortest-path relaxations can read as emphasis. */
export const edgeStroke = {
  network: "#2b3b57",
  subsidised: "#ffc857",
  relaxed: "#5ad1ff",
  mst: "#3ddc97",
  selected: "#ffffff",
} as const

/** Per-stage accent used by the trace log and the pipeline indicator. */
export const stageColor: Record<string, string> = {
  build: text.muted,
  dijkstra: status.good,
  bellman: status.good,
  floyd: status.accent,
  johnson: status.accent,
  mst: status.good,
  knapsack: status.violet,
  heldkarp: status.violet,
  twoopt: status.violet,
  sim: status.accent,
  repair: status.warn,
}
