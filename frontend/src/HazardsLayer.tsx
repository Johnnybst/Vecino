import { useMapPopup } from './useMapPopup'
import { useEffect, useMemo, useState } from 'react'
import { InfoWindow, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { reportSummary, useI18n } from './i18n'
import { demoMode } from './config'
import { reportColor, reportSeverity, severitySymbols } from './reportStyle'
import type { Severity } from './reportStyle'
import { MapGeometry } from './MapGeometry'

export type Hazard = {
  type: 'Feature'
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
  properties: {
    id: string
    summary: string
    reported_at: string
    confidence: number
    report_count: number
    weight: number
    severity?: Severity
    radius_m?: number
    reroute?: boolean
  }
}

function isHazard(value: unknown): value is Hazard {
  if (!value || typeof value !== 'object') return false
  const feature = value as Hazard
  const properties = feature.properties
  return feature.type === 'Feature' && feature.geometry?.type === 'Polygon'
    && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length > 0
    && feature.geometry.coordinates.every((ring) => Array.isArray(ring) && ring.length >= 4
      && ring.every((point) => Array.isArray(point) && point.length >= 2
        && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180
        && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90))
    && !!properties && typeof properties.id === 'string'
    && typeof properties.summary === 'string'
    && typeof properties.reported_at === 'string' && Number.isFinite(Date.parse(properties.reported_at))
    && Number.isFinite(properties.confidence) && properties.confidence >= 0 && properties.confidence <= 1
    && Number.isInteger(properties.report_count) && properties.report_count >= 0
    && Number.isFinite(properties.weight) && properties.weight >= 0 && properties.weight <= 1
    && (properties.severity === undefined || ['low', 'medium', 'high'].includes(properties.severity))
    && (properties.radius_m === undefined || (Number.isFinite(properties.radius_m) && properties.radius_m > 0))
    && (properties.reroute === undefined || typeof properties.reroute === 'boolean')
}

export function HazardsLayer({ onHazardsChange, hideStatus = false, at, preview = false }: {
  onHazardsChange: (hazards: Hazard[]) => void
  hideStatus?: boolean
  at?: string
  preview?: boolean
}) {
  const { t, language } = useI18n()
  const map = useMap()
  const maps = useMapsLibrary('maps')
  const [hazards, setHazards] = useState<Hazard[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const { selectedId, toggle, close } = useMapPopup()
  const [updatedAt, setUpdatedAt] = useState(0)

  useEffect(() => {
    let disposed = false
    let controller: AbortController | undefined
    let nextRefresh: ReturnType<typeof setTimeout> | undefined
    const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

    async function refresh() {
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 10000)
      try {
        const response = await fetch(`${baseUrl}/hazards${at ? `?at=${encodeURIComponent(at)}` : ''}`, {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
        })
        if (!response.ok) throw new Error('Reports unavailable')
        const data: unknown = await response.json()
        if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'FeatureCollection'
          || !('features' in data) || !Array.isArray(data.features) || !data.features.every(isHazard)) {
          throw new Error('Invalid reports')
        }
        if (disposed) return
        // Critical reports gray out but stay; the server already drops the rest after 3 hours.
        const visible = data.features.filter((feature) => feature.properties.weight >= 0.1
          || reportSeverity(feature.properties) === 'high')
        setHazards(visible)
        onHazardsChange(visible)
        setUpdatedAt(at ? Date.parse(at) : Date.now())
        setStatus('ready')
      } catch {
        if (disposed) return
        // Remove old circles rather than presenting them as current reports.
        setHazards([])
        onHazardsChange([])
        setStatus('error')
      } finally {
        clearTimeout(timeout)
        if (!disposed) nextRefresh = setTimeout(refresh, 60000)
      }
    }

    void refresh()
    return () => {
      disposed = true
      controller?.abort()
      clearTimeout(nextRefresh)
    }
  }, [onHazardsChange, at])

  useEffect(() => {
    if (!map || !maps) return
    const circles = hazards.map((feature) => {
      const circle = new maps.Polygon({
        map,
        paths: feature.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
        fillColor: reportColor(feature.properties, updatedAt),
        // Keep Google's polygon as the click target; SVG supplies the CSS fade.
        fillOpacity: 0,
        strokeColor: reportColor(feature.properties, updatedAt),
        strokeWeight: 2,
        strokeOpacity: 0,
        zIndex: 1,
      })
      const listener = circle.addListener('click', () => {
        toggle(feature.properties.id)
      })
      return { circle, listener }
    })
    return () => circles.forEach(({ circle, listener }) => {
      listener.remove()
      circle.setMap(null)
    })
  }, [map, maps, hazards, updatedAt, toggle])

  const shapes = useMemo(() => hazards.map((feature) => ({
    id: feature.properties.id,
    rings: feature.geometry.coordinates,
    color: reportColor(feature.properties, updatedAt),
    fillOpacity: 0.15 + 0.45 * feature.properties.weight,
  })), [hazards, updatedAt])

  const selected = hazards.find((feature) => feature.properties.id === selectedId)
  const ring = selected?.geometry.coordinates[0].slice(0, -1)
  const position = ring && {
    lng: ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    lat: ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  }

  return (
    <>
      <MapGeometry shapes={shapes} polygons />
      <p className={`hazards-status${hideStatus ? ' with-route' : ''}${preview ? ' fade-status' : ''}`} role="status" hidden={hideStatus && status === 'ready'}>
        {status === 'loading' && (demoMode ? t.loadingReports : t.loadingLiveReports)}
        {status === 'ready' && (preview ? t.previewReportStatus(hazards.length)
          : demoMode ? t.reportsStatus(hazards.length) : t.liveReportsStatus(hazards.length))}
        {status === 'error' && t.reportsUnavailable}
      </p>
      {selected && position && (
        <InfoWindow position={position} headerDisabled maxWidth={260}
          onClose={close}>
          <div className="report-popup">
            <button type="button" className="report-popup-close" aria-label={t.closePopup} onClick={close}>×</button>
            <strong>{demoMode ? t.activityDemo : t.reportedArea}</strong>
            <p><span aria-hidden="true" style={{ color: reportColor(selected.properties, updatedAt) }}>{severitySymbols[reportSeverity(selected.properties)]}</span> {t.severityLabels[reportSeverity(selected.properties)]}</p>
            <p>{reportSummary(selected.properties.summary, selected.properties.report_count, language)}</p>
            <p>{t.areaReports(selected.properties.report_count)}</p>
            <p>{t.reportAge(Math.max(0, Math.floor((updatedAt - Date.parse(selected.properties.reported_at)) / 60000)))}</p>
            <p>{t.confidence(selected.properties.confidence)}</p>
            {demoMode && <p>{t.syntheticNotice}</p>}
          </div>
        </InfoWindow>
      )}
    </>
  )
}
