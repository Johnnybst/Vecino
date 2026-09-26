import { useEffect, useState } from 'react'
import { useMap } from '@vis.gl/react-google-maps'
import { HazardsLayer } from './HazardsLayer'
import { LanguageSelect } from './LanguageSelect'
import { useI18n } from './i18n'

const ignorePreviewReports = () => {}

export function FadePreview({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const map = useMap()
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [minutes, setMinutes] = useState(0)
  const [appliedMinutes, setAppliedMinutes] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setAppliedMinutes(minutes), 250)
    return () => clearTimeout(timer)
  }, [minutes])

  useEffect(() => {
    if (!map) return
    const center = map.getCenter()
    const zoom = map.getZoom()
    map.fitBounds({ south: 25.69, west: -80.44, north: 25.9, east: -80.13 },
      { top: 190, right: 30, bottom: 250, left: 30 })
    return () => {
      if (center) map.setCenter(center)
      if (zoom !== undefined) map.setZoom(zoom)
    }
  }, [map])

  const at = appliedMinutes === 0 ? undefined : new Date(startedAt + appliedMinutes * 60000).toISOString()

  return (
    <>
      <div className="demo-heading">
        <strong>Vecino · {t.fadePreview}</strong>
        <div className="heading-controls"><LanguageSelect />
          <button type="button" className="location-button" onClick={onClose}>{t.back}</button>
        </div>
      </div>
      <HazardsLayer key={at ?? 'now'} at={at} preview onHazardsChange={ignorePreviewReports} />
      <section className="demo-card fade-card" aria-label={t.fadePreview}>
        <p className="demo-notice">{t.fadeHint}</p>
        <label className="fade-label" htmlFor="demo-time">{t.demoTime}</label>
        <output htmlFor="demo-time" className="fade-output">{t.timeAhead(minutes)}</output>
        <input id="demo-time" type="range" min="0" max="360" step="15" value={minutes}
          aria-valuetext={t.timeAhead(minutes)} onChange={(event) => {
            if (minutes === 0) setStartedAt(Date.now())
            setMinutes(Number(event.target.value))
          }} />
        <div className="fade-endpoints"><span>{t.timeAhead(0)}</span><span>{t.timeAhead(360)}</span></div>
        <button type="button" className="location-button" onClick={() => {
          setMinutes(0)
          setAppliedMinutes(0)
          setStartedAt(Date.now())
        }}>{t.resetTime}</button>
      </section>
    </>
  )
}
