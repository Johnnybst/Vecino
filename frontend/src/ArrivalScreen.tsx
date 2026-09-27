import { useEffect, useRef } from 'react'
import { useMap } from '@vis.gl/react-google-maps'
import { useI18n } from './i18n'

export type TripSummary = { minutes: number; distance_m: number; avoided: number }

// "You have arrived" screen. Done resets the map to the normal Miami view and starts fresh.
export function ArrivalScreen({ summary, onDone }: { summary: TripSummary; onDone: () => void }) {
  const { t } = useI18n()
  const map = useMap()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { button.current?.focus() }, [])

  function done() {
    map?.moveCamera({ center: { lat: 25.7617, lng: -80.1918 }, zoom: 12, heading: 0, tilt: 0 })
    onDone()
  }

  return <div className="arrival-backdrop" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
    <section className="arrival-card">
      <div className="arrival-check" aria-hidden="true">✓</div>
      <h2 id="arrival-title">{t.arrived}</h2>
      <p>{t.tripSummary(summary.minutes, summary.distance_m)}</p>
      {summary.avoided > 0 && <p>{t.tripAvoided(summary.avoided)}</p>}
      <button ref={button} type="button" className="sample-button" onClick={done}>{t.done}</button>
    </section>
  </div>
}
