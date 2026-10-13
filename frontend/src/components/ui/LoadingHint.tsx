import { useEffect, useState } from "react"

/** Appears only if a wait drags on; serverless backends can take several
 *  seconds to wake, and a bare spinner for that long reads as a hang. */
export function LoadingHint({ after = 4000, children }: { after?: number; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setShow(true), after)
    return () => clearTimeout(id)
  }, [after])
  return show ? <p className="text-caption leading-snug text-faint">{children}</p> : null
}
