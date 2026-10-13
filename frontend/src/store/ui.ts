// Ephemeral view state: what is open, selected or focused. Kept apart from
// instance (user input), solution (solver output) and playback (the clock) so
// that opening a panel can never look like a change to the problem or answer.
import { create } from "zustand"

export type ResultTab = "summary" | "vehicles" | "algorithms" | "experiments"
export type AlgorithmView = "trace" | "matrix" | "dp"
export type MobilePane = "none" | "controls" | "results"
export type ThemeName = "dark" | "light"

export type Selection =
  | { kind: "node"; id: number }
  | { kind: "edge"; u: number; v: number }
  | null

interface UiStore {
  theme: ThemeName
  leftOpen: boolean
  rightOpen: boolean
  resultTab: ResultTab
  algorithmView: AlgorithmView
  mobilePane: MobilePane
  /** Vehicle whose route is isolated on the canvas; null shows all. */
  focusedVehicle: number | null
  selection: Selection
  legendOpen: boolean
  openSections: Record<string, boolean>

  setTheme: (t: ThemeName) => void
  toggleTheme: () => void
  toggleLeft: () => void
  toggleRight: () => void
  setResultTab: (t: ResultTab) => void
  setAlgorithmView: (v: AlgorithmView) => void
  setMobilePane: (p: MobilePane) => void
  focusVehicle: (id: number | null) => void
  select: (s: Selection) => void
  toggleLegend: () => void
  toggleSection: (id: string) => void
}

// Algorithm choices lead, because demonstrating them is the point of the
// project; the generator knobs below them change far less often per session.
const DEFAULT_SECTIONS: Record<string, boolean> = {
  dataset: true,
  shortestPaths: true,
  backbone: true,
  selection: true,
  sequencing: true,
  fleet: true,
  simulation: true,
}

const THEME_KEY = "lastmile.theme"

/** Saved choice first, then the OS preference. Storage can throw (private
 *  windows, blocked site data), so every access is guarded. */
const initialTheme = (): ThemeName => {
  if (typeof window === "undefined") return "dark"
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === "dark" || saved === "light") return saved
  } catch { /* fall through to the OS preference */ }
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light"
  } catch { /* no matchMedia (tests, old engines) */ }
  return "dark"
}

const isPhone = () => {
  try { return window.matchMedia("(max-width: 767px)").matches } catch { return false }
}

/** Reflect the theme onto <html> so the CSS custom properties switch too. */
const applyTheme = (t: ThemeName, remember = false) => {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = t
  if (remember && typeof window !== "undefined") {
    try { localStorage.setItem(THEME_KEY, t) } catch { /* choice just won't persist */ }
  }
  return t
}

export const useUi = create<UiStore>((set) => ({
  theme: applyTheme(initialTheme()),
  leftOpen: true,
  rightOpen: true,
  resultTab: "summary",
  algorithmView: "trace",
  mobilePane: "none",
  focusedVehicle: null,
  selection: null,
  // The legend is a fixed block over the map; on a phone it would cover a
  // quarter of it, so it starts collapsed there.
  legendOpen: !isPhone(),
  openSections: DEFAULT_SECTIONS,

  setTheme: (t) => set({ theme: applyTheme(t, true) }),
  toggleTheme: () => set((s) => ({ theme: applyTheme(s.theme === "dark" ? "light" : "dark", true) })),
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  setResultTab: (resultTab) => set({ resultTab }),
  setAlgorithmView: (algorithmView) => set({ algorithmView }),
  setMobilePane: (mobilePane) => set({ mobilePane }),
  focusVehicle: (focusedVehicle) => set({ focusedVehicle }),
  select: (selection) => set({ selection }),
  toggleLegend: () => set((s) => ({ legendOpen: !s.legendOpen })),
  toggleSection: (id) =>
    set((s) => ({ openSections: { ...s.openSections, [id]: !s.openSections[id] } })),
}))
