import { useCallback, useEffect, useRef, useState } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

// A click on any map object dismisses the old popup. Selecting a report in
// that same click keeps its new popup open, even when Google stops bubbling.
export function useMapPopup() {
  const map = useMap()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selection = useRef(false)

  useEffect(() => {
    if (!map) return
    const element = map.getDiv()
    let pending: ReturnType<typeof setTimeout> | undefined
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.report-popup')) return
      selection.current = false
      clearTimeout(pending)
      pending = setTimeout(() => {
        if (!selection.current) setSelectedId(null)
      })
    }
    element.addEventListener('click', dismiss, true)
    return () => {
      element.removeEventListener('click', dismiss, true)
      clearTimeout(pending)
    }
  }, [map, selection])

  const toggle = useCallback((id: string) => {
    selection.current = true
    setSelectedId(current => current === id ? null : id)
  }, [selection])

  return { selectedId, toggle, close: () => setSelectedId(null) }
}
