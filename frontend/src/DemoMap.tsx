import { useEffect, useState } from 'react'
import { InfoWindow, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { demoHazards, demoRoute } from './demoData'
import { useI18n } from './i18n'
import { LanguageSelect } from './LanguageSelect'

const toPoint = ([lng, lat]: [number, number]) => ({ lat, lng })

export function DemoMap({ onClose }: { onClose: () => void }) {
  const { t, language } = useI18n()
  const map = useMap()
  const maps = useMapsLibrary('maps')
  const core = useMapsLibrary('core')
  const [selectedReport, setSelectedReport] = useState<typeof demoHazards.features[number] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!map || !maps || !core) return
    const previousCenter = map.getCenter()
    const previousZoom = map.getZoom()
    const circles = demoHazards.features.map((feature) => new maps.Polygon({
      map,
      paths: feature.geometry.coordinates.map((ring) => ring.map(toPoint)),
      fillColor: '#b85f61',
      fillOpacity: 0.15 + 0.45 * feature.properties.weight,
      strokeColor: '#a95356',
      strokeWeight: 2,
      clickable: true,
      zIndex: 1,
    }))
    const listeners = circles.map((circle, index) => circle.addListener('click', () => {
      setSelectedReport(demoHazards.features[index])
    }))
    const normal = new maps.Polyline({
      map,
      path: demoRoute.normal.geometry.coordinates.map(toPoint),
      strokeOpacity: 0,
      icons: [{
        icon: { path: 'M 0,-1 0,1', strokeColor: '#606971', strokeOpacity: 1, strokeWeight: 4, scale: 3 },
        offset: '0',
        repeat: '18px',
      }],
      clickable: false,
      zIndex: 3,
    })
    const safe = new maps.Polyline({
      map,
      path: demoRoute.safe.geometry.coordinates.map(toPoint),
      strokeColor: '#24764c',
      strokeOpacity: 1,
      strokeWeight: 6,
      clickable: false,
      zIndex: 2,
    })
    const bounds = new core.LatLngBounds()
    demoRoute.safe.geometry.coordinates.forEach((point) => bounds.extend(toPoint(point)))
    map.fitBounds(bounds, { top: 135, right: 35, bottom: 260, left: 35 })

    return () => {
      listeners.forEach((listener) => listener.remove())
      circles.forEach((circle) => circle.setMap(null))
      normal.setMap(null)
      safe.setMap(null)
      if (previousCenter) map.setCenter(previousCenter)
      if (previousZoom !== undefined) map.setZoom(previousZoom)
    }
  }, [map, maps, core])

  const areasAvoided = new Set(demoRoute.safe.hazards_avoided).size
  const selectedProperties = selectedReport?.properties
  const ring = selectedReport?.geometry.coordinates[0].slice(0, -1)
  const popupPosition = ring && {
    lng: ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    lat: ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  }

  return (
    <>
      {selectedProperties && popupPosition && (
        <InfoWindow
          position={popupPosition}
          onCloseClick={() => setSelectedReport(null)}
          headerContent={t.sampleArea}
          maxWidth={260}
        >
          <div className="report-popup">
            <p>{t.sampleSummary}</p>
            <p>{t.areaReports(selectedProperties.report_count)}</p>
            <p>{t.reportAge(Math.max(0, Math.floor((now - Date.parse(selectedProperties.reported_at)) / 60000)))}</p>
            <p>{t.confidence(selectedProperties.confidence)}</p>
            <p>{t.sampleDataNotice}</p>
          </div>
        </InfoWindow>
      )}
      <div className="demo-heading">
        <strong>Vecino · {t.sampleMap}</strong>
        <div className="heading-controls"><LanguageSelect />
          <button type="button" className="location-button" onClick={onClose}>{t.back}</button>
        </div>
      </div>
      <section className="demo-card route-card" aria-label={t.sampleComparison}>
        <p className="demo-notice">{t.sampleNotice}</p>
        <h2>{t.routeHeadline(demoRoute.extra_minutes, areasAvoided)}</h2>
        <p>{demoRoute.explanation[language]}</p>
        <ul className="map-legend" aria-label={t.legend}>
          <li><span className="legend-detour" />{t.detour}</li>
          <li><span className="legend-normal" />{t.usualRoute}</li>
          <li><span className="legend-report" />{t.reportedArea}</li>
        </ul>
      </section>
    </>
  )
}
