// Keyboard route into the canvas. Nodes and roads are mouse-first SVG shapes,
// so the canvas lets the keyboard step through them instead: the selection
// card then reports the details exactly as a click would.

import type { Selection } from "../store/ui"
import type { Instance } from "../types"

export type StepKind = "node" | "edge"
type Graph = Pick<Instance, "nodes" | "edges">
type Item = NonNullable<Selection>

const same = (a: Selection, b: Item): boolean => {
  if (!a || a.kind !== b.kind) return false
  if (a.kind === "node") return a.id === (b as { id: number }).id
  const e = b as { u: number; v: number }
  return (a.u === e.u && a.v === e.v) || (a.u === e.v && a.v === e.u)
}

/** The next (dir 1) or previous (dir -1) node or road, wrapping at the ends.
 *  Starting from nothing selected, forward lands on the first and backward on
 *  the last. */
export function stepSelection(graph: Graph, current: Selection, kind: StepKind, dir: 1 | -1): Selection {
  const items: Item[] = kind === "node"
    ? graph.nodes.map((n) => ({ kind: "node", id: n.id }))
    : graph.edges.map((e) => ({ kind: "edge", u: e.u, v: e.v }))
  if (items.length === 0) return current
  const at = items.findIndex((it) => same(current, it))
  if (at < 0) return dir > 0 ? items[0] : items[items.length - 1]
  return items[(at + dir + items.length) % items.length]
}

const nodeName = (graph: Graph, id: number) => {
  const n = graph.nodes.find((x) => x.id === id)
  return n?.label || `junction ${id}`
}

/** One sentence for a screen-reader live region. */
export function describeSelection(graph: Graph, sel: Selection): string {
  if (!sel) return ""
  if (sel.kind === "node") {
    const n = graph.nodes.find((x) => x.id === sel.id)
    return n ? `${nodeName(graph, n.id)}, ${n.kind}` : ""
  }
  return `Road between ${nodeName(graph, sel.u)} and ${nodeName(graph, sel.v)}`
}
