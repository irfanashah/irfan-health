'use client'

import { useEffect, useRef, useState } from 'react'

/** Measure the parent's clientWidth responsively (ported from 06-charts.jsx). */
export function useMeasure(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width)
    })
    ro.observe(ref.current)
    setW(ref.current.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}
