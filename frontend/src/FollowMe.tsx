// Follow-me mode: a blue "you are here" dot the map keeps centered, the route behind you erased,
// and a small card with the next turn, time left and arrival time.
// Location stays on this device except for "New route from here", which the person taps.
import { useEffect, useRef, useState } from 'react'
import { Marker, useMap } from '@vis.gl/react-google-maps'
import { useI18n } from './i18n'
import type { TextKey } from './i18n'
import { headingAhead, metresAhead, progressOnLine } from './nav'
import { mapId } from './config'
import { askCompassPermission, watchCompass } from './compass'
import type { Progress } from './nav'
import type { RouteLine } from './routeTypes'

type Spot = { lat: number; lng: number }

const OFF_ROUTE_M = 50
const OFF_ROUTE_READINGS = 3
// Close-up "trip" view. Turning and tilting only work on a vector map (VITE_GOOGLE_MAP_ID).
const TRIP_ZOOM = 18
const TRIP_TILT = mapId ? 45 : 0

export function FollowMe({ route, onProgress, onRecalculate, navigating = false, onEnd }: {
  route?: RouteLine
  // A started trip: follow automatically, zoom in and face the direction of travel.
  navigating?: boolean
  onEnd?: () => void
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
  // Which way you face: the phone's compass, or your direction of travel while moving.
  const [compass, setCompass] = useState<number | null>(null)
  const [travelHeading, setTravelHeading] = useState<number | null>(null)
  // How far the map itself is turned, so the beam still points the right way on screen.
  const [mapHeading, setMapHeading] = useState(0)
  const [message, setMessage] = useState<TextKey | ''>('')
  const [offRoute, setOffRoute] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const misses = useRef(0)
  const firstFix = useRef(true)
  const routeRef = useRef(route)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { routeRef.current = route }, [route])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  const active = following || navigating
  const navigatingRef = useRef(navigating)
  useEffect(() => { navigatingRef.current = navigating }, [navigating])

  // Starting a trip: jump to the start, zoomed in and facing the first stretch of road.
  // Ending it: level the map again (the route overview refits itself).
  useEffect(() => {
    if (!map) return
    const line = routeRef.current?.geometry.coordinates
    if (navigating && line && line.length >= 2) {
      const heading = headingAhead(line, { index: 0, point: line[0], offRouteM: 0 })
      map.moveCamera({ center: { lat: line[0][1], lng: line[0][0] }, zoom: TRIP_ZOOM, heading, tilt: TRIP_TILT })
    } else if (!navigating) {
      map.moveCamera({ heading: 0, tilt: 0 })
    }
  }, [navigating, map])

  // Listen to the compass only while following (it never leaves the phone).
  useEffect(() => {
    if (!active) return
    return watchCompass(setCompass)
  }, [active])

  useEffect(() => {
    if (!active) return
    firstFix.current = true
    misses.current = 0
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude, lng: coords.longitude }
        setSpot(next)
        setFixAt(Date.now())
        setMessage('')
        // Direction of travel is only meaningful while actually moving (> ~1 m/s).
        if (Number.isFinite(coords.heading) && (coords.speed ?? 0) > 1) setTravelHeading(coords.heading)
        const line = routeRef.current?.geometry.coordinates
        const here = line && line.length >= 2 ? progressOnLine(next, line) : null
        if (map && navigatingRef.current) {
          // Face the way the route goes while on it; otherwise the phone's own direction of travel.
          const heading = here && here.offRouteM <= OFF_ROUTE_M ? headingAhead(line!, here)
            : Number.isFinite(coords.heading) ? coords.heading! : map.getHeading() ?? 0
          map.moveCamera({ center: next, zoom: TRIP_ZOOM, heading, tilt: TRIP_TILT })
          setMapHeading(mapId ? heading : 0)
        } else if (map) {
          map.panTo(next)
          if (firstFix.current) map.setZoom(Math.max(map.getZoom() ?? 16, 16))
        }
        firstFix.current = false
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
  }, [active, map])

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
      setCompass(null)
      setTravelHeading(null)
    } else if (!navigator.geolocation) {
      setMessage('locationUnavailable')
    } else {
      void askCompassPermission()
      setMessage('locating')
      setFollowing(true)
    }
  }

  // Next turn, time left and arrival time, from where you are on the route.
  const line = route?.geometry.coordinates
  const usable = active && !offRoute && route && line && progress && progress.index < line.length - 1
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

  const facing = compass ?? travelHeading
  return <>
    {active && spot && facing !== null && <Marker position={spot} zIndex={19} clickable={false}
      icon={{ path: 'M 0,0 L -15,-36 A 39,39 0 0,1 15,-36 Z', rotation: (facing - (navigating ? mapHeading : 0) + 360) % 360,
        fillColor: '#1a73e8', fillOpacity: 0.28, strokeWeight: 0, scale: 1 }} />}
    {active && spot && <Marker position={spot} title={t.youAreHere} zIndex={20}
      icon={{ path: 'M -8,0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0',
        fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3, scale: 1 }} />}
    <div className="follow-me">
      {navigating
        ? <button type="button" className="location-button end-trip" onClick={onEnd}>
          <span aria-hidden="true">■</span> {t.endTrip}</button>
        : <button type="button" className="location-button" aria-pressed={following} onClick={toggle}>
          <span aria-hidden="true">◎</span> {following ? t.stopFollowing : t.followMe}
        </button>}
      {message && <p className="follow-status" role="status">{t[message]}</p>}
      {card}
      {active && offRoute && route && <div className="follow-status off-route" role="alert">
        <p>{onRecalculate ? t.offRoute : t.offRouteEdit}</p>
        {onRecalculate && <button type="button" className="sample-button" onClick={newRouteHere}
          disabled={recalculating}>{recalculating ? t.findingRoutes : t.newRouteHere}</button>}
      </div>}
    </div>
  </>
}
