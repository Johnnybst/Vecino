import { useEffect, useMemo } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import type { RouteResult } from './routeTypes'
import { useI18n } from './i18n'
import { TripMarkers } from './TripMarkers'
import { MapGeometry } from './MapGeometry'
import { demoMode } from './config'
import { lineAhead } from './nav'
import type { Progress } from './nav'

export function RouteLayer({ result, progress, navigating = false, onStart }: {
  result: RouteResult
  // While following: where you are on the green route, so the part behind you is erased.
  progress?: Progress | null
  // During a trip the card tucks away; the overview comes back when the trip ends.
  navigating?: boolean
  onStart?: () => void
}) {
  const { t, language } = useI18n()
  const map = useMap()
  const maps = useMapsLibrary('maps')
  const core = useMapsLibrary('core')
  const route = result.data
  // Older deployments may not yet send the explicit detour flag.
  const hasDetour = route.has_detour ?? (JSON.stringify(route.safe.geometry.coordinates) !== JSON.stringify(route.normal.geometry.coordinates))

  useEffect(() => {
    if (!map || !maps || !core || navigating) return
    const toPoint = ([lng, lat]: [number, number]) => ({ lat, lng })
    const bounds = new core.LatLngBounds()
    for (const line of [route.safe, route.normal]) {
      line.geometry.coordinates.forEach((point) => bounds.extend(toPoint(point)))
    }
    const panel = document.querySelector('.vecino-panel')
    const flowingLayout = panel && getComputedStyle(panel).position !== 'absolute'
    map.fitBounds(bounds, flowingLayout ? 30 : { top: 220, right: 40, bottom: 280, left: 40 })
  }, [map, maps, core, route, hasDetour, navigating])

  // Usual route first so it sits under the green one, like Google's alternate routes.
  const safeLine = route.safe.geometry.coordinates
  const ahead = progress && progress.index < safeLine.length - 1 ? lineAhead(safeLine, progress) : null
  const shapes = useMemo(() => [
    ...(hasDetour ? [{ id: 'normal', rings: [route.normal.geometry.coordinates], color: '#dadce0', muted: true }] : []),
    { id: 'safe', rings: [ahead ?? safeLine], color: '#24764c', still: !!ahead },
  ], [route, hasDetour, ahead, safeLine])

  const avoided = new Set(route.safe.hazards_avoided)
  const nearStart = !!route.endpoint_reports?.origin.length
  const nearDestination = !!route.endpoint_reports?.destination.length
  const warningTitle = nearStart && nearDestination ? t.activityBoth
    : nearStart ? t.activityStart
    : nearDestination ? t.activityDestination : t.nearbyActivity

  return (
    <>
      <MapGeometry shapes={shapes} />
      <TripMarkers coordinates={route.safe.geometry.coordinates} />
      <section className="demo-card route-card" aria-label={t.routeComparison} hidden={navigating}>
        {route.left_out.length > 0 && (
          <div className="route-warning" role="alert">
            <strong>{warningTitle}</strong>
            <p>{t.leftOut}</p>
          </div>
        )}
        {!!route.sightings_on_route?.length && (
          <div className="route-warning sighting-notice" role="status">
            <strong>{t.sightingsTitle}</strong>
            <p>{t.sightingsText(route.sightings_on_route.length)}</p>
          </div>
        )}
        <p className="demo-notice">{demoMode ? t.routeNotice : t.liveRouteNotice}</p>
        <h2>{hasDetour ? t.routeHeadline(route.extra_minutes, avoided.size) : t.usualRoute}</h2>
        <p>{route.explanation[language]}</p>
        <p className="route-details">
          {t.routeDetails(Math.ceil(route.safe.duration_s / 60), route.safe.distance_m / 1000, hasDetour)}
        </p>
        <ul className="map-legend" aria-label={t.legend}>
          <li><span className="legend-detour" />{hasDetour ? t.detour : t.usualRoute}</li>
          {hasDetour && <li><span className="legend-normal" />{t.usualRoute}</li>}
          <li><span className="legend-report" />{t.reportedArea}</li>
        </ul>
        {onStart && <button type="button" className="sample-button start-trip" onClick={onStart}>
          <span aria-hidden="true">➤</span> {t.startTrip}</button>}
      </section>
    </>
  )
}
