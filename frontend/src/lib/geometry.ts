// Viewport maths for the graph canvas.

export interface ViewBox { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

export const VIEWBOX_PAD = 0.06 // fraction of the larger span, kept on every side

/**
 * Fit a viewBox around real node coordinates.
 *
 * The generator does NOT guarantee coordinates inside the unit square: the
 * radial topology lays rings around a centre and routinely pushes 30-60% of
 * nodes outside [0,1] (measured: seed 7 -> 31%, seed 1 @ n=60 -> 58%). The
 * original canvas hard-coded viewBox="0 0 1000 1000", so every one of those
 * nodes -- named pickup and drop stops, not just filler junctions -- was
 * silently clipped out of view along with the route legs touching them.
 * Deriving the box from the actual extent is what makes the whole instance
 * visible; see geometry.test.ts for the regression.
 *
 * A square box is returned so the SVG's default xMidYMid-meet scaling cannot
 * stretch the network's aspect ratio in a non-square container.
 */
export function fitViewBox(points: Point[], pad = VIEWBOX_PAD): ViewBox {
  if (points.length === 0) return { x: 0, y: 0, w: 1, h: 1 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  // A degenerate span (every node stacked on one point) would divide by zero
  // downstream, so fall back to a unit window centred on the cluster.
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const margin = span * pad
  const side = span + margin * 2
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return { x: cx - side / 2, y: cy - side / 2, w: side, h: side }
}

/**
 * Widen (never shrink) a box to a container's aspect ratio.
 *
 * A square viewBox in a wide panel gets letterboxed by SVG's meet scaling, so
 * the network is drawn into a square in the middle and a third of the
 * workspace goes unused. Growing the short axis to match the container fills
 * that space while keeping every point inside the box and the scale uniform.
 */
export function expandToAspect(vb: ViewBox, aspect: number): ViewBox {
  if (!Number.isFinite(aspect) || aspect <= 0) return vb
  const current = vb.w / vb.h
  if (Math.abs(current - aspect) < 1e-6) return vb

  const cx = vb.x + vb.w / 2
  const cy = vb.y + vb.h / 2
  const [w, h] = aspect > current ? [vb.h * aspect, vb.h] : [vb.w, vb.w / aspect]
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/** Zoom about a fixed point (the cursor), so content under it stays put. */
export function zoomAt(vb: ViewBox, factor: number, anchor: Point): ViewBox {
  const w = vb.w * factor
  const h = vb.h * factor
  return {
    x: anchor.x - (anchor.x - vb.x) * (w / vb.w),
    y: anchor.y - (anchor.y - vb.y) * (h / vb.h),
    w,
    h,
  }
}

export const clampZoom = (vb: ViewBox, base: ViewBox, min = 0.08, max = 4): ViewBox => {
  const scale = vb.w / base.w
  if (scale >= min && scale <= max) return vb
  const target = Math.min(max, Math.max(min, scale))
  const factor = target / scale
  const cx = vb.x + vb.w / 2
  const cy = vb.y + vb.h / 2
  return { x: cx - (vb.w * factor) / 2, y: cy - (vb.h * factor) / 2, w: vb.w * factor, h: vb.h * factor }
}

export const viewBoxString = (vb: ViewBox) => `${vb.x} ${vb.y} ${vb.w} ${vb.h}`

/** Convert a pixel delta on screen into a delta in viewBox units. */
export function pixelsToUnits(dxPx: number, dyPx: number, vb: ViewBox, rect: { width: number; height: number }) {
  // The SVG uses xMidYMid meet, so both axes share the smaller scale factor.
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h) || 1
  return { x: dxPx / scale, y: dyPx / scale }
}

/** Map a client-space pixel position to a coordinate inside the viewBox. */
export function clientToUnits(
  clientX: number, clientY: number, vb: ViewBox, rect: DOMRect,
): Point {
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h) || 1
  // meet-scaling letterboxes the shorter axis; recover the offset it introduced.
  const offsetX = (rect.width - vb.w * scale) / 2
  const offsetY = (rect.height - vb.h * scale) / 2
  return {
    x: vb.x + (clientX - rect.left - offsetX) / scale,
    y: vb.y + (clientY - rect.top - offsetY) / scale,
  }
}
