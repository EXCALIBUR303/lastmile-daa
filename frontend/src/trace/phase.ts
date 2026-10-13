// Which part of the story the canvas should foreground. The trace interleaves
// stages (each zone runs selection, then sequencing, then simulation), so the
// stage of the current step alone flickers; phases are therefore milestones:
// once the first route-building step has played, the canvas stays in "routes".


export type Phase = "idle" | "search" | "zoning" | "routes"

const ZONING = new Set(["mst", "knapsack"])
const ROUTES = new Set(["heldkarp", "twoopt", "sim", "repair"])

export interface Milestones { zoningFrom: number; routesFrom: number }

/** Index of the first zoning and first route step (-1 when absent). */
export function milestones(trace: readonly { stage: string }[]): Milestones {
  let zoningFrom = -1, routesFrom = -1
  trace.forEach((s, i) => {
    if (zoningFrom < 0 && (ZONING.has(s.stage) || ROUTES.has(s.stage))) zoningFrom = i
    if (routesFrom < 0 && ROUTES.has(s.stage)) routesFrom = i
  })
  return { zoningFrom, routesFrom }
}

/** Phase after `cursor` steps have played. The final frame always shows routes. */
export function phaseAt(m: Milestones, cursor: number, total: number): Phase {
  if (cursor <= 0) return "idle"
  if (total > 0 && cursor >= total) return "routes"
  if (m.routesFrom >= 0 && cursor > m.routesFrom) return "routes"
  if (m.zoningFrom >= 0 && cursor > m.zoningFrom) return "zoning"
  return "search"
}
