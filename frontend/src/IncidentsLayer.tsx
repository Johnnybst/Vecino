import { useEffect, useState } from 'react'
import { InfoWindow, Marker } from '@vis.gl/react-google-maps'
import { useI18n } from './i18n'
import { incidentText } from './incidentText'
import roadIncidentIcon from './assets/road-incident.svg'

const incidentTypes = ['crash', 'stalled_vehicle', 'road_closed', 'lane_closed'] as const
type IncidentType = typeof incidentTypes[number]
type Incident = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { id: string; type: IncidentType; description: string; started_at: string }
}

function isIncident(value: unknown): value is Incident {
  if (!value || typeof value !== 'object') return false
  const item = value as Incident
  const point = item.geometry?.coordinates
  return item.type === 'Feature' && item.geometry?.type === 'Point' && Array.isArray(point)
    && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
    && point[0] >= -80.88 && point[0] <= -80.11 && point[1] >= 25.13 && point[1] <= 25.98
    && !!item.properties && typeof item.properties.id === 'string'
    && incidentTypes.includes(item.properties.type)
    && typeof item.properties.description === 'string'
    && Number.isFinite(Date.parse(item.properties.started_at))
}

export function IncidentsLayer() {
  const { t, language } = useI18n()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let disposed = false
    let controller: AbortController | undefined
    let next: ReturnType<typeof setTimeout> | undefined
    async function refresh() {
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 40000)
      try {
        const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
        const response = await fetch(`${baseUrl}/incidents`, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
        if (!response.ok) throw new Error('Unavailable')
        const data = await response.json()
        if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid incidents')
        if (disposed) return
        setIncidents(data.features.filter(isIncident))
        setNow(Date.now())
        setStatus('ready')
      } catch {
        if (disposed) return
        setIncidents([])
        setStatus('error')
      } finally {
        clearTimeout(timeout)
        if (!disposed) next = setTimeout(refresh, 300000)
      }
    }
    void refresh()
    const clock = setInterval(() => setNow(Date.now()), 60000)
    return () => { disposed = true; controller?.abort(); clearTimeout(next); clearInterval(clock) }
  }, [])
  const selected = incidents.find((item) => item.properties.id === selectedId)
  return <>
    <p className="incidents-status" role="status">{status === 'loading' ? t.incidentsLoading
      : status === 'error' ? t.incidentsUnavailable : incidents.length ? t.incidentsNotice : t.incidentsEmpty}</p>
    {incidents.map((item) => <Marker key={item.properties.id}
      position={{ lng: item.geometry.coordinates[0], lat: item.geometry.coordinates[1] }}
      title={`${t.incidents}: ${t.incidentTypes[item.properties.type]}`} zIndex={8}
      icon={roadIncidentIcon}
      onClick={() => setSelectedId(current => current === item.properties.id ? null : item.properties.id)} />)}
    {selected && <InfoWindow position={{ lng: selected.geometry.coordinates[0], lat: selected.geometry.coordinates[1] }}
      headerContent={<strong className="incident-popup-title"><img src={roadIncidentIcon} alt="" width="22" height="24" style={{ verticalAlign: 'middle', marginRight: 6 }} />{t.incidentTypes[selected.properties.type]}</strong>}
      maxWidth={260} onCloseClick={() => setSelectedId(null)}>
      <div className="report-popup" onClick={() => setSelectedId(null)}><p>{incidentText(selected.properties.description, language)}</p>
        <p>{t.incidentAge(Math.max(0, Math.floor((now - Date.parse(selected.properties.started_at)) / 60000)))}</p>
        <p>{t.incidentsNotice}</p></div>
    </InfoWindow>}
  </>
}
