import { useI18n } from './i18n'

export function TimeSlider({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const { t } = useI18n()
  return <section className="time-slider" aria-label={t.fadePreview}>
    <div className="slider-heading">
      <label htmlFor="demo-time">{t.demoTime}</label>
      <output htmlFor="demo-time">{t.timeAhead(minutes)}</output>
      <button type="button" className="location-button" onClick={() => onChange(0)}>{t.resetTime}</button>
    </div>
    <input id="demo-time" type="range" min="0" max="360" step="15" value={minutes}
      aria-valuetext={t.timeAhead(minutes)} onChange={(event) => onChange(Number(event.target.value))} />
    <p>{t.previewOnly}</p>
  </section>
}
