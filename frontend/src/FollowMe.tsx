// Follow-me mode: a blue "you are here" dot the map keeps centered, with a beam showing where you face.
// During a started trip: close-up view that turns with you, the route behind you erased, a card with
// the next turn / time left / arrival time, and the trip ends by itself when you arrive.
// Location stays on this device except for "New route from here", which the person taps.
import { useEffect, useRef, useState } from 'react'
import { Marker, useMap } from '@vis.gl/react-google-maps'
import { useI18n } from './i18n'
import type { TextKey } from './i18n'
import { RouteLoading } from './RouteLoading'
import { headingAhead, metres, metresAhead, progressOnLine } from './nav'
import { mapId } from './config'
import { askCompassPermission, watchCompass } from './compass'
import type { Progress } from './nav'
import type { RouteLine } from './routeTypes'

type Spot = { lat: number; lng: number }
type Profile = 'driving-car' | 'foot-walking' | 'cycling-regular'

const OFF_ROUTE_M = 50
const OFF_ROUTE_READINGS = 3
// Close-up "trip" view per travel mode. Turning and tilting only work on a vector map (VITE_GOOGLE_MAP_ID).
const TRIP_ZOOM: Record<Profile, number> = { 'foot-walking': 19, 'cycling-regular': 18.5, 'driving-car': 18 }
const TRIP_TILT = mapId ? 45 : 0
// The trip ends by itself this close to the destination (~50 ft walking).
const ARRIVE_M: Record<Profile, number> = { 'foot-walking': 15, 'cycling-regular': 25, 'driving-car': 40 }
// Within this distance of the route, draw the dot on the route (like Google Maps) so it doesn't wobble.
const SNAP_M: Record<Profile, number> = { 'foot-walking': 12, 'cycling-regular': 20, 'driving-car': 25 }

export function FollowMe({ route, profile = 'driving-car', onProgress, onRecalculate, navigating = false,
  onEnd, onArrive }: {
  route?: RouteLine
  profile?: Profile
  // A started trip: follow automatically, zoom in and turn with you.
  navigating?: boolean
  onEnd?: () => void
  onArrive?: () => void
  // Where you are along the route (null when not following), so the map can erase the part behind you.
  onProgress: (progress: Progress | null) => void
  // Asks for a new route from this spot; returns '' or the message to show.
  onRecalculate?: (from: Spot) => Promise<TextKey | ''>
}) {
  const { t, language } = useI18n()
  const map = useMap()
  const [following, setFollowing] = useState(false)
  // Raw GPS spot (used for "New route from here") and the spot drawn on the map (snapped to the route).
  const [spot, setSpot] = useState<Spot | null>(null)
  const [shown, setShown] = useState<Spot | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  // Time of the latest location reading; the arrival time counts from it.
  const [fixAt, setFixAt] = useState(0)
  // Which way you face: the phone's compass, or your direction of travel while moving.
  const [compass, setCompass] = useState<number | null>(null)
  const [travelHeading, setTravelHeading] = useState<number | null>(null)
  // How far the map itself is turned (driving follows the road), so the beam points the right way on screen.
  const [mapHeading, setMapHeading] = useState(0)
  const [message, setMessage] = useState<TextKey | ''>('')
  const [offRoute, setOffRoute] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const misses = useRef(0)
  const firstFix = useRef(true)
  const routeRef = useRef(route)
  const profileRef = useRef(profile)
  const compassRef = useRef(compass)
  const onProgressRef = useRef(onProgress)
  const onArriveRef = useRef(onArrive)
  const navigatingRef = useRef(navigating)
  useEffect(() => { routeRef.current = route }, [route])
  useEffect(() => { profileRef.current = profile }, [profile])
  useEffect(() => { compassRef.current = compass }, [compass])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  useEffect(() => { onArriveRef.current = onArrive }, [onArrive])
  useEffect(() => { navigatingRef.current = navigating }, [navigating])
  const active = following || navigating
  // Walking and biking: the map turns with the phone's compass. Driving: it follows the road
  // (a compass inside a car is unreliable), like Google Maps.
  const compassTurnsMap = navigating && !!mapId && profile !== 'driving-car' && compass !== null

  // Starting a trip: jump to the start, zoomed in and facing the first stretch of road.
  // Ending it: level the map again (the route overview refits itself).
  useEffect(() => {
    if (!map) return
    const line = routeRef.current?.geometry.coordinates
    if (navigating && line && line.length >= 2) {
      const heading = headingAhead(line, { index: 0, point: line[0], offRouteM: 0 })
      map.moveCamera({ center: { lat: line[0][1], lng: line[0][0] }, zoom: TRIP_ZOOM[profileRef.current],
        heading, tilt: TRIP_TILT })
    } else if (!navigating) {
      map.moveCamera({ heading: 0, tilt: 0 })
    }
  }, [navigating, map])

  // Listen to the compass only while following (it never leaves the phone).
  useEffect(() => {
    if (!active) return
    return watchCompass(setCompass)
  }, [active])

  // Look around while walking or biking on a trip: the map turns with you.
  useEffect(() => {
    if (map && compassTurnsMap && compass !== null) map.setHeading(compass)
  }, [map, compassTurnsMap, compass])

  useEffect(() => {
    if (!active) return
    firstFix.current = true
    misses.current = 0
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude, lng: coords.longitude }
        const trip = navigatingRef.current
        const mode = profileRef.current
        setSpot(next)
        setFixAt(Date.now())
        setMessage('')
        // Direction of travel is only meaningful while actually moving (> ~1 m/s).
        if (Number.isFinite(coords.heading) && (coords.speed ?? 0) > 1) setTravelHeading(coords.heading)
        const line = routeRef.current?.geometry.coordinates
        const here = line && line.length >= 2 ? progressOnLine(next, line) : null
        // On a trip and close to the route: draw the dot on the route so it doesn't wobble beside it.
        const snapped = trip && here && here.offRouteM <= SNAP_M[mode]
          ? { lat: here.point[1], lng: here.point[0] } : next
        setShown(snapped)
        if (map && trip) {
          const byCompass = !!mapId && mode !== 'driving-car' && compassRef.current !== null
          // Walk/bike: where you look. Drive: the road ahead, or the car's direction of travel off route.
          const heading = byCompass ? compassRef.current!
            : here && here.offRouteM <= OFF_ROUTE_M ? headingAhead(line!, here)
            : Number.isFinite(coords.heading) ? coords.heading! : map.getHeading() ?? 0
          map.moveCamera({ center: snapped, zoom: TRIP_ZOOM[mode], heading, tilt: TRIP_TILT })
          setMapHeading(mapId ? heading : 0)
        } else if (map) {
          map.panTo(next)
          if (firstFix.current) map.setZoom(Math.max(map.getZoom() ?? 16, 16))
        }
        firstFix.current = false
        // Off the green route for a few readings in a row? Offer a new route (no automatic rerouting).
        misses.current = here && here.offRouteM > OFF_ROUTE_M ? misses.current + 1 : 0
        setOffRoute(misses.current >= OFF_ROUTE_READINGS)
        // Only erase the route behind you while you are actually on it.
        const onRoute = here && here.offRouteM <= OFF_ROUTE_M ? here : null
        setProgress(onRoute)
        onProgressRef.current(onRoute)
        // Close enough to the destination: finish the trip.
        if (trip && line && line.length >= 2) {
          const toEnd = Math.min(metres([next.lng, next.lat], line[line.length - 1]),
            onRoute ? metresAhead(line, onRoute) : Infinity)
          if (toEnd <= ARRIVE_M[mode]) {
            setMessage('arrived')
            onArriveRef.current?.()
          }
        }
      },
      (error) => {
        setMessage(error.code === 1 ? 'locationDenied' : 'locationFailed')
        setFollowing(false)
        setSpot(null)
        setShown(null)
        setProgress(null)
        onProgressRef.current(null)
      },
      // Always a fresh reading (never a cached one) for the most accurate position.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
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
      setShown(null)
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

  // Next turn, time left and arrival time: only during a started trip.
  const line = route?.geometry.coordinates
  const usable = navigating && !offRoute && route && line && progress && progress.index < line.length - 1
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

  // The beam points where you face, measured against how far the map itself is turned.
  const facing = compass ?? travelHeading
  const screenTurn = compassTurnsMap ? compass! : navigating ? mapHeading : 0
  const dot = shown ?? spot
  return <>
    {active && dot && facing !== null && <Marker position={dot} zIndex={19} clickable={false}
      icon={{ path: 'M 0,0 L -15,-36 A 39,39 0 0,1 15,-36 Z', rotation: (facing - screenTurn + 360) % 360,
        fillColor: '#1a73e8', fillOpacity: 0.28, strokeWeight: 0, scale: 1 }} />}
    {active && dot && <Marker position={dot} title={t.youAreHere} zIndex={20}
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
          aria-busy={recalculating} disabled={recalculating}>{recalculating ? t.findingRoutes : t.newRouteHere}</button>}
        {recalculating && <RouteLoading />}
      </div>}
    </div>
  </>
}
