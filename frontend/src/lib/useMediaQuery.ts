import { useEffect, useState } from "react"

/** Breakpoints the shell switches layout at. */
export const BREAKPOINT = { tablet: 768, desktop: 1280 } as const

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}

/** Three-way layout mode. The shell renders a different chrome for each. */
export function useLayoutMode(): "mobile" | "tablet" | "desktop" {
  const desktop = useMediaQuery(`(min-width: ${BREAKPOINT.desktop}px)`)
  const tablet = useMediaQuery(`(min-width: ${BREAKPOINT.tablet}px)`)
  return desktop ? "desktop" : tablet ? "tablet" : "mobile"
}
