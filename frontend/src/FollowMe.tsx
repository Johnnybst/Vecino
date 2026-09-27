// Follow-me mode: a blue "you are here" dot that the map keeps centered.
// Location stays on this device; nothing here is sent to the server.
import { useEffect, useRef, useState } from 'react'
import { Marker, useMap } from '@vis.gl/react-google-maps'
import { useI18n } from './i18n'
import type { TextKey } from './i18n'

type Spot = { lat: number; lng: number }

const OFF_ROUTE_M = 50
const OFF_ROUTE_READINGS = 3

// Closest distance in metres from a spot to a [lng, lat] line (flat-earth is fine at city scale).
function distanceToLine(spot: Spot, line: [number, number][]) {
  const toXY = ([lng, lat]: [number, number]) => [
    (lng - spot.lng) * 111320 * Math.cos(spot.lat * Math.PI / 180), (lat - spot.lat) * 111320]
  let closest = Infinity
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = toXY(line[i - 1]), [bx, by] = toXY(line[i])
    const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy
    const t = lengthSq ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0
    closest = Math.min(closest, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return closest
}

export function FollowMe({ line, onRecalculate }: {
  line?: [number, number][]
  // Asks for a new route from this spot; returns '' or the message to show.
  onRecalculate?: (from: Spot) => Promise<TextKey | ''>
}) {
  const { t } = useI18n()
  const map = useMap()
  const [following, setFollowing] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [message, setMessage] = useState<TextKey | ''>('')
  const [offRoute, setOffRoute] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const misses = useRef(0)
  const firstFix = useRef(true)
  const lineRef = useRef(line)
  useEffect(() => { lineRef.current = line }, [line])

  useEffect(() => {
    if (!following) return
    firstFix.current = true
    misses.current = 0
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude, lng: coords.longitude }
        setSpot(next)
        setMessage('')
        if (map) {
          map.panTo(next)
          if (firstFix.current) map.setZoom(Math.max(map.getZoom() ?? 16, 16))
        }
        firstFix.current = false
        // Off the green route for a few readings in a row? Say so (no automatic rerouting).
        const route = lineRef.current
        misses.current = route && route.length >= 2 && distanceToLine(next, route) > OFF_ROUTE_M
          ? misses.current + 1 : 0
        setOffRoute(misses.current >= OFF_ROUTE_READINGS)
      },
      (error) => {
        setMessage(error.code === 1 ? 'locationDenied' : 'locationFailed')
        setFollowing(false)
        setSpot(null)
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [following, map])

  // The location leaves the phone only here: one /route request, only when tapped.
  async function newRouteHere() {
    if (!spot || !onRecalculate || recalculating) return
    setRecalculating(true)
    setMessage('')
    const error = await onRecalculate(spot)
    setRecalculating(false)
    if (error) {
      setMessage(error)
    } else {
      misses.current = 0
      setOffRoute(false)
    }
  }

  function toggle() {
    if (following) {
      setFollowing(false)
      setSpot(null)
      setMessage('')
      setOffRoute(false)
    } else if (!navigator.geolocation) {
      setMessage('locationUnavailable')
    } else {
      setMessage('locating')
      setFollowing(true)
    }
  }

  return <>
    {following && spot && <Marker position={spot} title={t.youAreHere} zIndex={20}
      icon={{ path: 'M -8,0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0',
        fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3, scale: 1 }} />}
    <div className="follow-me">
      <button type="button" className="location-button" aria-pressed={following} onClick={toggle}>
        <span aria-hidden="true">◎</span> {following ? t.stopFollowing : t.followMe}
      </button>
      {message && <p className="follow-status" role="status">{t[message]}</p>}
      {following && offRoute && line && <div className="follow-status off-route" role="alert">
        <p>{onRecalculate ? t.offRoute : t.offRouteEdit}</p>
        {onRecalculate && <button type="button" className="sample-button" onClick={newRouteHere}
          disabled={recalculating}>{recalculating ? t.findingRoutes : t.newRouteHere}</button>}
      </div>}
    </div>
  </>
}
