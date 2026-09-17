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

/** Reflect the theme onto <html> so the CSS custom properties switch too. */
const applyTheme = (t: ThemeName) => {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = t
  return t
}

export const useUi = create<UiStore>((set) => ({
  theme: applyTheme("dark"),
  leftOpen: true,
  rightOpen: true,
  resultTab: "summary",
  algorithmView: "trace",
  mobilePane: "none",
  focusedVehicle: null,
  selection: null,
  legendOpen: true,
  openSections: DEFAULT_SECTIONS,

  setTheme: (t) => set({ theme: applyTheme(t) }),
  toggleTheme: () => set((s) => ({ theme: applyTheme(s.theme === "dark" ? "light" : "dark") })),
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
