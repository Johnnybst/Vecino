import { useEffect } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import type { RouteResult } from './routeTypes'
import { useI18n } from './i18n'
import { LanguageSelect } from './LanguageSelect'
import { demoMode } from './config'

export function RouteLayer({ result, onEdit }: { result: RouteResult; onEdit: () => void }) {
  const { t, language } = useI18n()
  const map = useMap()
  const maps = useMapsLibrary('maps')
  const core = useMapsLibrary('core')
  const route = result.data

  useEffect(() => {
    if (!map || !maps || !core) return
    const toPoint = ([lng, lat]: [number, number]) => ({ lat, lng })
    const normal = new maps.Polyline({
      map,
      path: route.normal.geometry.coordinates.map(toPoint),
      strokeOpacity: 0,
      icons: [{
        icon: { path: 'M 0,-1 0,1', strokeColor: '#606971', strokeOpacity: 1, strokeWeight: 4, scale: 3 },
        offset: '0', repeat: '18px',
      }],
      clickable: false,
      zIndex: 3,
    })
    const safe = new maps.Polyline({
      map,
      path: route.safe.geometry.coordinates.map(toPoint),
      strokeColor: '#24764c', strokeOpacity: 1, strokeWeight: 6,
      clickable: false,
      zIndex: 2,
    })
    const bounds = new core.LatLngBounds()
    for (const line of [route.safe, route.normal]) {
      line.geometry.coordinates.forEach((point) => bounds.extend(toPoint(point)))
    }
    map.fitBounds(bounds, { top: 135, right: 40, bottom: 280, left: 40 })
    return () => {
      normal.setMap(null)
      safe.setMap(null)
    }
  }, [map, maps, core, route])

  const avoided = new Set(route.safe.hazards_avoided)
  const nearStart = !!route.endpoint_reports?.origin.length
  const nearDestination = !!route.endpoint_reports?.destination.length
  const warningTitle = nearStart && nearDestination ? t.activityBoth
    : nearStart ? t.activityStart
    : nearDestination ? t.activityDestination : t.nearbyActivity
  const overlapping = JSON.stringify(route.safe.geometry.coordinates) === JSON.stringify(route.normal.geometry.coordinates)

  return (
    <>
      <div className="demo-heading">
        <strong>Vecino · {t.yourRoutes}</strong>
        <div className="heading-controls"><LanguageSelect />
          <button type="button" className="location-button" onClick={onEdit}>{t.editTrip}</button>
        </div>
      </div>
      <section className="demo-card route-card" aria-label={t.routeComparison}>
        {route.left_out.length > 0 && (
          <div className="route-warning" role="alert">
            <strong>{warningTitle}</strong>
            <p>{t.leftOut}</p>
          </div>
        )}
        <p className="demo-notice">{demoMode ? t.routeNotice : t.liveRouteNotice}</p>
        <h2>{t.routeHeadline(route.extra_minutes, avoided.size)}</h2>
        <p>{route.explanation[language]}</p>
        <p className="route-details">
          {t.routeDetails(Math.ceil(route.safe.duration_s / 60), route.safe.distance_m / 1000)}
        </p>
        {overlapping && <p className="route-details">{t.samePath}</p>}
        <ul className="map-legend" aria-label={t.legend}>
          <li><span className="legend-detour" />{t.detour}</li>
          <li><span className="legend-normal" />{t.usualRoute}</li>
          <li><span className="legend-report" />{t.reportedArea}</li>
        </ul>
      </section>
    </>
  )
}
