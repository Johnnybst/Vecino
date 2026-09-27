import { useEffect } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'

export function TrafficLayer({ enabled }: { enabled: boolean }) {
  const map = useMap()
  const maps = useMapsLibrary('maps')
  useEffect(() => {
    if (!map || !maps || !enabled) return
    const layer = new maps.TrafficLayer({ map })
    return () => layer.setMap(null)
  }, [map, maps, enabled])
  return null
}
