// Follow-me mode: a blue "you are here" dot the map keeps centered, the route behind you erased,
// and a small card with the next turn, time left and arrival time.
// Location stays on this device except for "New route from here", which the person taps.
import { useEffect, useRef, useState } from 'react'
import { Marker, useMap } from '@vis.gl/react-google-maps'
import { useI18n } from './i18n'
import type { TextKey } from './i18n'
import { metresAhead, progressOnLine } from './nav'
import type { Progress } from './nav'
import type { RouteLine } from './routeTypes'

type Spot = { lat: number; lng: number }

const OFF_ROUTE_M = 50
const OFF_ROUTE_READINGS = 3

export function FollowMe({ route, onProgress, onRecalculate }: {
  route?: RouteLine
  // Where you are along the route (null when not following), so the map can erase the part behind you.
  onProgress: (progress: Progress | null) => void
  // Asks for a new route from this spot; returns '' or the message to show.
  onRecalculate?: (from: Spot) => Promise<TextKey | ''>
}) {
  const { t, language } = useI18n()
  const map = useMap()
  const [following, setFollowing] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  // Time of the latest location reading; the arrival time counts from it.
  const [fixAt, setFixAt] = useState(0)
  const [message, setMessage] = useState<TextKey | ''>('')
  const [offRoute, setOffRoute] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const misses = useRef(0)
  const firstFix = useRef(true)
  const routeRef = useRef(route)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { routeRef.current = route }, [route])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  useEffect(() => {
    if (!following) return
    firstFix.current = true
    misses.current = 0
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude, lng: coords.longitude }
        setSpot(next)
        setFixAt(Date.now())
        setMessage('')
        if (map) {
          map.panTo(next)
          if (firstFix.current) map.setZoom(Math.max(map.getZoom() ?? 16, 16))
        }
        firstFix.current = false
        const line = routeRef.current?.geometry.coordinates
        const here = line && line.length >= 2 ? progressOnLine(next, line) : null
        // Off the green route for a few readings in a row? Offer a new route (no automatic rerouting).
        misses.current = here && here.offRouteM > OFF_ROUTE_M ? misses.current + 1 : 0
        const off = misses.current >= OFF_ROUTE_READINGS
        setOffRoute(off)
        // Only erase the route behind you while you are actually on it.
        const onRoute = here && here.offRouteM <= OFF_ROUTE_M ? here : null
        setProgress(onRoute)
        onProgressRef.current(onRoute)
      },
      (error) => {
        setMessage(error.code === 1 ? 'locationDenied' : 'locationFailed')
        setFollowing(false)
        setSpot(null)
        setProgress(null)
        onProgressRef.current(null)
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
      setProgress(null)
      onProgress(null)
    }
  }

  function toggle() {
    if (following) {
      setFollowing(false)
      setSpot(null)
      setMessage('')
      setOffRoute(false)
      setProgress(null)
      onProgress(null)
    } else if (!navigator.geolocation) {
      setMessage('locationUnavailable')
    } else {
      setMessage('locating')
      setFollowing(true)
    }
  }

  // Next turn, time left and arrival time, from where you are on the route.
  const line = route?.geometry.coordinates
  const usable = following && !offRoute && route && line && progress && progress.index < line.length - 1
  let card = null
  if (usable) {
    const nextStep = route.steps?.find((step) => step.at > progress.index)
    const toTurn = nextStep ? metresAhead(line, progress, nextStep.at) : 0
    const left = metresAhead(line, progress)
    const secondsLeft = route.distance_m > 0 ? left * route.duration_s / route.distance_m : 0
    const arrival = new Date(fixAt + secondsLeft * 1000)
      .toLocaleTimeString(language === 'ht' ? 'fr-HT' : language, { hour: 'numeric', minute: '2-digit' })
    card = <div className="nav-card" role="status" aria-live="polite">
      {nextStep
        ? <p className="nav-turn"><strong>{t.inDistance(toTurn)}</strong> {nextStep.instruction}</p>
        : <p className="nav-turn"><strong>{t.almostThere}</strong></p>}
      <p className="nav-eta">{t.timeLeft(Math.max(1, Math.round(secondsLeft / 60)), left, arrival)}</p>
    </div>
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
      {card}
      {following && offRoute && route && <div className="follow-status off-route" role="alert">
        <p>{onRecalculate ? t.offRoute : t.offRouteEdit}</p>
        {onRecalculate && <button type="button" className="sample-button" onClick={newRouteHere}
          disabled={recalculating}>{recalculating ? t.findingRoutes : t.newRouteHere}</button>}
      </div>}
    </div>
  </>
}
