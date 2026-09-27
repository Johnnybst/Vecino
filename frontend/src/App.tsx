import { useEffect, useRef, useState } from 'react'
import { APIProvider, Map, useMapsLibrary } from '@vis.gl/react-google-maps'
import './App.css'
import { DemoMap } from './DemoMap'
import { HazardsLayer } from './HazardsLayer'
import type { Hazard } from './HazardsLayer'
import { RouteLayer } from './RouteLayer'
import { isRouteResponse } from './routeTypes'
import type { RouteResult } from './routeTypes'
import { I18nContext, messages, useI18n } from './i18n'
import type { Language, TextKey } from './i18n'
import { LanguageSelect } from './LanguageSelect'
import { TrafficLayer } from './TrafficLayer'
import { SeverityLegend } from './SeverityLegend'
import { TimeSlider } from './TimeSlider'

import { demoMode } from './config'

const ignorePreviewReports = () => {}
const coverage = { south: 25.13, north: 25.98, west: -80.88, east: -80.11 }
const insideCoverage = ({ lat, lng }: Coordinates) => lat >= coverage.south && lat <= coverage.north && lng >= coverage.west && lng <= coverage.east

type Coordinates = { lat: number; lng: number }
const travelModes = [
  { profile: 'driving-car', label: 'drive' },
  { profile: 'foot-walking', label: 'walk' },
  { profile: 'cycling-regular', label: 'bike' },
] as const

function AddressInput({ kind, onSelect }: {
  kind: 'from' | 'to'
  onSelect: (location: Coordinates | null) => void
}) {
  const places = useMapsLibrary('places')
  const { t } = useI18n()
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<(HTMLElement & { placeholder: string }) | null>(null)
  const [message, setMessage] = useState<TextKey | ''>('')

  useEffect(() => {
    if (!places || !container.current) return

    const input = new places.PlaceAutocompleteElement({
      includedRegionCodes: ['us'],
      locationRestriction: coverage,
    })
    widget.current = input
    container.current.appendChild(input)
    let revision = 0
    let disposed = false

    const clearSelection = () => {
      revision += 1
      onSelect(null)
      setMessage('')
    }
    const showError = () => {
      revision += 1
      onSelect(null)
      setMessage('addressUnavailable')
    }
    const select = async (event: InstanceType<NonNullable<typeof places>['PlacePredictionSelectEvent']>) => {
      const request = ++revision
      onSelect(null)
      setMessage('checkingAddress')
      try {
        const place = event.placePrediction.toPlace()
        await place.fetchFields({ fields: ['location'] })
        if (disposed || request !== revision) return
        if (!place.location) {
          setMessage('chooseAnotherAddress')
          return
        }
        onSelect(place.location.toJSON())
        setMessage('addressSelected')
      } catch {
        if (!disposed && request === revision) showError()
      }
    }

    input.addEventListener('input', clearSelection)
    input.addEventListener('gmp-select', select)
    input.addEventListener('gmp-error', showError)
    return () => {
      disposed = true
      input.removeEventListener('input', clearSelection)
      input.removeEventListener('gmp-select', select)
      input.removeEventListener('gmp-error', showError)
      input.remove()
      widget.current = null
    }
  }, [places, onSelect])

  useEffect(() => {
    if (!widget.current) return
    widget.current.placeholder = kind === 'from' ? t.originPlaceholder : t.destinationPlaceholder
    widget.current.setAttribute('aria-label', t[kind])
  }, [t, kind, places])

  return (
    <div className="address-field">
      <span className="address-label"><span aria-hidden="true">{kind === 'from' ? '●' : '⚑'}</span> {t[kind]}</span>
      <div ref={container} />
      <p className="address-status" role="status">
        {places ? (message ? t[message] : '') : t.loadingAddress}
      </p>
    </div>
  )
}

function AddressPanel({ onShowDemo, onRoute, hazards }: {
  onShowDemo: () => void
  onRoute: (result: RouteResult) => void
  hazards: Hazard[]
}) {
  const { t } = useI18n()
  const [origin, setOrigin] = useState<Coordinates | null>(null)
  const [destination, setDestination] = useState<Coordinates | null>(null)
  const [profile, setProfile] = useState<typeof travelModes[number]['profile']>('driving-car')
  const [originMode, setOriginMode] = useState<'address' | 'locating' | 'location'>('address')
  const [locationError, setLocationError] = useState<TextKey | ''>('')
  const locationRequest = useRef(0)
  const routeRequest = useRef<AbortController | null>(null)
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [routeError, setRouteError] = useState<TextKey | ''>('')

  useEffect(() => () => {
    locationRequest.current += 1
    routeRequest.current?.abort()
  }, [])

  async function findRoutes() {
    if (!origin || !destination || routeRequest.current) return
    if (!insideCoverage(origin) || !insideCoverage(destination)) {
      setRouteError('outsideArea')
      return
    }
    const controller = new AbortController()
    routeRequest.current = controller
    setLoadingRoute(true)
    setRouteError('')
    const timeout = setTimeout(() => controller.abort(), 70000)
    const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
    try {
      const response = await fetch(`${baseUrl}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, profile }),
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        setRouteError(response.status === 422
          ? error?.detail === 'outside_area' ? 'outsideArea' : 'reselectAddresses'
          : 'routesUnavailable')
        return
      }
      const data: unknown = await response.json()
      if (!isRouteResponse(data)) {
        setRouteError('routeIncomplete')
        return
      }
      onRoute({ data, hazards })
    } catch {
      setRouteError(controller.signal.aborted
        ? 'routeStopped'
        : 'serverUnavailable')
    } finally {
      clearTimeout(timeout)
      routeRequest.current = null
      setLoadingRoute(false)
    }
  }

  function chooseAddress() {
    locationRequest.current += 1
    setOrigin(null)
    setOriginMode('address')
    setLocationError('')
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError('locationUnavailable')
      return
    }
    const request = ++locationRequest.current
    setOrigin(null)
    setOriginMode('locating')
    setLocationError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (request !== locationRequest.current) return
        setOrigin({ lat: coords.latitude, lng: coords.longitude })
        setOriginMode('location')
      },
      (error) => {
        if (request !== locationRequest.current) return
        setOriginMode('address')
        setLocationError(error.code === 1
          ? 'locationDenied'
          : 'locationFailed')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  return (
    <section className="address-panel" aria-label={t.chooseTrip}>
      <div className="panel-title"><h1>Vecino</h1><LanguageSelect /></div>
      <p className="panel-subtitle">{t.whereGoing}</p>
      <div inert={loadingRoute}>
      {originMode === 'address' ? (
        <>
          <AddressInput kind="from" onSelect={setOrigin} />
          <button className="location-button" type="button" onClick={useCurrentLocation}>
            {t.useLocation}
          </button>
        </>
      ) : (
        <div className="address-field">
          <span className="address-label">{t.from}</span>
          <p className="current-location" role="status">
            {originMode === 'locating' ? t.locating : t.locationSelected}
          </p>
          <button className="location-button" type="button" onClick={chooseAddress}>
            {originMode === 'locating' ? t.cancelLocation : t.useAddress}
          </button>
        </div>
      )}
      {locationError && <p className="address-status" role="alert">{t[locationError]}</p>}
      <AddressInput kind="to" onSelect={setDestination} />
      <fieldset className="travel-modes">
        <legend>{t.travelBy}</legend>
        <div className="travel-options">
          {travelModes.map((mode) => (
            <label className="travel-option" key={mode.profile}>
              <input
                type="radio"
                name="profile"
                value={mode.profile}
                checked={profile === mode.profile}
                onChange={() => setProfile(mode.profile)}
              />
              <span>{t[mode.label]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="trip-status" role="status">
        {origin && destination ? t.tripSelected : t.chooseAddresses}
      </p>
      </div>
      <button type="button" className="sample-button" onClick={findRoutes}
        disabled={!origin || !destination || loadingRoute}>
        {loadingRoute ? t.findingRoutes : t.findRoutes}
      </button>
      {loadingRoute && (
        <button type="button" className="location-button" onClick={() => routeRequest.current?.abort()}>
          {t.cancel}
        </button>
      )}
      {routeError && <p className="address-status" role="alert">{t[routeError]}</p>}
      <button type="button" className="location-button sample-link" onClick={onShowDemo} disabled={loadingRoute}>
        {t.showSample}
      </button>
    </section>
  )
}

function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY
  const [showDemo, setShowDemo] = useState(false)
  const [traffic, setTraffic] = useState(false)
  const [minutes, setMinutes] = useState(0)
  const [previewAt, setPreviewAt] = useState<string | undefined>()
  useEffect(() => {
    const timer = setTimeout(() => setPreviewAt(minutes ? new Date(Date.now() + minutes * 60000).toISOString() : undefined), 250)
    return () => clearTimeout(timer)
  }, [minutes])
  const [hazards, setHazards] = useState<Hazard[]>([])
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [language, setLanguage] = useState<Language>('en')
  const t = messages[language]

  useEffect(() => { document.documentElement.lang = language }, [language])

  if (!apiKey) {
    return (
      <main className="setup-message">
        <h1>Vecino</h1>
        <p>{t.missingKey}</p>
      </main>
    )
  }

  return (
    <I18nContext.Provider value={{ language, setLanguage }}>
    <main className={`map-screen${!showDemo ? ' main-map' : ''}${route ? ' has-route' : ''}`} aria-label={t.mapLabel}>
      <APIProvider apiKey={apiKey}>
        <Map
          style={{ width: '100%', height: '100%' }}
          defaultCenter={{ lat: 25.7617, lng: -80.1918 }}
          defaultZoom={12}
          gestureHandling="greedy"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
        />
        <div hidden={showDemo || route !== null}>
          <AddressPanel onShowDemo={() => setShowDemo(true)} onRoute={(result) => { setMinutes(0); setPreviewAt(undefined); setRoute(result) }} hazards={hazards} />
        </div>
        {showDemo && <DemoMap onClose={() => setShowDemo(false)} />}
        {!showDemo && <HazardsLayer key={previewAt ?? 'now'} at={previewAt}
          onHazardsChange={previewAt ? ignorePreviewReports : setHazards} hideStatus={route !== null} />}
        <TrafficLayer enabled={traffic && !showDemo} />
        {!showDemo && <div className="bottom-stack">
          <div className="map-tools">
            <label><input type="checkbox" checked={traffic} onChange={(event) => setTraffic(event.target.checked)} />{t.traffic}</label>
            <SeverityLegend />
          </div>
          {demoMode && <TimeSlider minutes={minutes} onChange={setMinutes} />}
          {route && <RouteLayer result={route} onEdit={() => { setRoute(null); setMinutes(0); setPreviewAt(undefined) }} />}
        </div>}
      </APIProvider>
    </main>
    </I18nContext.Provider>
  )
}

export default App
