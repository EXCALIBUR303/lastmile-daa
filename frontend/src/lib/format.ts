// Every number the UI prints goes through here, so precision and units stay
// consistent across the KPI grid, vehicle rows, tooltips and charts.

/** Profit / cost. The generator's money is dimensionless, so callers label the
 *  unit in the field name ("Gross profit (units)") rather than faking a currency. */
export const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Compact money for dense rows and chart axes: no decimals past 3 digits. */
export const moneyShort = (n: number) =>
  Math.abs(n) >= 1000
    ? `${(n / 1000).toFixed(1)}k`
    : n.toLocaleString("en-US", { maximumFractionDigits: 0 })

/** Durations are minutes throughout the solver. */
export const minutes = (n: number) => `${Math.round(n).toLocaleString("en-US")} min`

/** Long form for tooltips where a raw minute count is hard to picture. */
export const minutesLong = (n: number) => {
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

/** One decimal place everywhere, so 100.0% and 33.3% line up in a column. */
export const percent = (n: number) => `${n.toFixed(1)}%`

/** Takes a 0-1 ratio rather than an already-scaled percentage. */
export const ratioPercent = (n: number) => percent(n * 100)

export const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(2)} ms`)

export const count = (n: number) => n.toLocaleString("en-US")

/** Signed delta for "x% over the bound" style comparisons. */
export const signedPercent = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(0)}%`

/** Model identifiers (dp_deadline, insertion_2opt, ...) into display text. */
export const humanise = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
