// Follow-me mode: a blue "you are here" dot with a beam showing where you face.
// During a started trip: close-up view that turns with you, the route behind you erased, a card with
// the next turn / time left / arrival time, and the trip ends by itself when you arrive.
// The dot, camera and rotation glide between GPS readings instead of jumping.
// Location stays on this device except for "New route from here", which the person taps.
import { useEffect, useRef, useState } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
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
// Each animation frame moves this share of the remaining way: about a second to reach a new GPS spot.
const GLIDE = 0.08
const TURN = 0.12

const DOT_ICON = { path: 'M -8,0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0',
  fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3, scale: 1 }
const BEAM_PATH = 'M 0,0 L -15,-36 A 39,39 0 0,1 15,-36 Z'

// Turn part of the way from one compass direction to another, the short way round.
function turnToward(from: number, to: number, share: number) {
  const diff = ((to - from + 540) % 360) - 180
  return (from + diff * share + 360) % 360
}

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
  const markerLib = useMapsLibrary('marker')
  const [following, setFollowing] = useState(false)
  // Raw GPS spot, used for "New route from here".
  const [spot, setSpot] = useState<Spot | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  // Time of the latest location reading; the arrival time counts from it.
  const [fixAt, setFixAt] = useState(0)
  const [message, setMessage] = useState<TextKey | ''>('')
  const [offRoute, setOffRoute] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const misses = useRef(0)
  const firstFix = useRef(true)
  // What the animation glides toward: where to draw the dot, and which way the map should face.
  const target = useRef<Spot | null>(null)
  const roadHeading = useRef<number | null>(null)
  const compass = useRef<number | null>(null)
  const travelHeading = useRef<number | null>(null)
  const routeRef = useRef(route)
  const profileRef = useRef(profile)
  const onProgressRef = useRef(onProgress)
  const onArriveRef = useRef(onArrive)
  const navigatingRef = useRef(navigating)
  useEffect(() => { routeRef.current = route }, [route])
  useEffect(() => { profileRef.current = profile }, [profile])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  useEffect(() => { onArriveRef.current = onArrive }, [onArrive])
  useEffect(() => { navigatingRef.current = navigating }, [navigating])
  const active = following || navigating

  // Starting a trip: jump to the start, zoomed in and facing the first stretch of road.
  // Ending it: level the map again (the route overview refits itself).
  useEffect(() => {
    if (!map) return
    const line = routeRef.current?.geometry.coordinates
    if (navigating && line && line.length >= 2) {
      const heading = headingAhead(line, { index: 0, point: line[0], offRouteM: 0 })
      roadHeading.current = heading
      map.moveCamera({ center: { lat: line[0][1], lng: line[0][0] }, zoom: TRIP_ZOOM[profileRef.current],
        heading, tilt: TRIP_TILT })
    } else if (!navigating) {
      map.moveCamera({ heading: 0, tilt: 0 })
    }
  }, [navigating, map])

  // Listen to the compass only while following (it never leaves the phone).
  useEffect(() => {
    if (!active) return
    const stop = watchCompass((degrees) => { compass.current = degrees })
    return () => { stop(); compass.current = null }
  }, [active])

  // Draw the dot and beam, and move the camera, gliding a little every frame toward the latest reading.
  useEffect(() => {
    if (!active || !map || !markerLib) return
    const dot = new markerLib.Marker({ map, zIndex: 20, clickable: false, icon: DOT_ICON, visible: false })
    const beam = new markerLib.Marker({ map, zIndex: 19, clickable: false, visible: false })
    let pos: Spot | null = null
    let heading = map.getHeading() ?? 0
    let beamTurn = -999
    let frame = 0
    const tick = () => {
      const goal = target.current
      if (goal) {
        const moved = !pos || Math.abs(goal.lat - pos.lat) + Math.abs(goal.lng - pos.lng) > 1e-7
        pos = pos ? { lat: pos.lat + (goal.lat - pos.lat) * GLIDE, lng: pos.lng + (goal.lng - pos.lng) * GLIDE } : goal
        dot.setPosition(pos)
        beam.setPosition(pos)
        dot.setVisible(true)
        const trip = navigatingRef.current
        // Walking/biking: face where you look (compass). Driving: face the road ahead.
        const byCompass = profileRef.current !== 'driving-car' && compass.current !== null
        const want = !trip || !mapId ? 0 : byCompass ? compass.current! : roadHeading.current ?? heading
        const turned = Math.abs(((want - heading + 540) % 360) - 180) > 0.2
        heading = turnToward(heading, want, TURN)
        if (trip && (moved || turned)) map.moveCamera({ center: pos, heading })
        else if (!trip && moved) map.moveCamera({ center: pos })
        // The beam points where you face, measured against how far the map is turned.
        const facing = compass.current ?? travelHeading.current
        if (facing === null) {
          beam.setVisible(false)
        } else {
          const turn = (facing - (trip && mapId ? heading : 0) + 360) % 360
          if (Math.abs(turn - beamTurn) > 1) {
            beam.setIcon({ path: BEAM_PATH, rotation: turn, fillColor: '#1a73e8', fillOpacity: 0.28, strokeWeight: 0, scale: 1 })
            beamTurn = turn
          }
          beam.setVisible(true)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      dot.setMap(null)
      beam.setMap(null)
    }
  }, [active, map, markerLib])

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
        if (Number.isFinite(coords.heading) && (coords.speed ?? 0) > 1) travelHeading.current = coords.heading
        const line = routeRef.current?.geometry.coordinates
        const here = line && line.length >= 2 ? progressOnLine(next, line) : null
        const onRoute = here && here.offRouteM <= OFF_ROUTE_M ? here : null
        // On a trip and close to the route: draw the dot on the route so it doesn't wobble beside it.
        target.current = trip && here && here.offRouteM <= SNAP_M[mode] ? { lat: here.point[1], lng: here.point[0] } : next
        roadHeading.current = onRoute ? headingAhead(line!, onRoute) : travelHeading.current ?? roadHeading.current
        if (map && firstFix.current && !trip) map.setZoom(Math.max(map.getZoom() ?? 16, 16))
        firstFix.current = false
        // Off the green route for a few readings in a row? Offer a new route (no automatic rerouting).
        misses.current = here && here.offRouteM > OFF_ROUTE_M ? misses.current + 1 : 0
        setOffRoute(misses.current >= OFF_ROUTE_READINGS)
        // Only erase the route behind you while you are actually on it.
        setProgress(onRoute)
        onProgressRef.current(onRoute)
        // Close enough to the destination: finish the trip.
        if (trip && line && line.length >= 2) {
          const toEnd = Math.min(metres([next.lng, next.lat], line[line.length - 1]),
            onRoute ? metresAhead(line, onRoute) : Infinity)
          if (toEnd <= ARRIVE_M[mode]) onArriveRef.current?.()
        }
      },
      (error) => {
        setMessage(error.code === 1 ? 'locationDenied' : 'locationFailed')
        setFollowing(false)
        setSpot(null)
        target.current = null
        setProgress(null)
        onProgressRef.current(null)
      },
      // Always a fresh reading (never a cached one) for the most accurate position.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    return () => {
      navigator.geolocation.clearWatch(watch)
      target.current = null
    }
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

  return <div className="follow-me">
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
}
