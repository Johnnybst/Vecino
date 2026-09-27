import { useI18n } from './i18n'

export function TimeSlider({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const { t } = useI18n()
  return <section className="time-slider" aria-label={t.historyLabel}>
    <div className="slider-heading">
      <label htmlFor="demo-time">{t.historyTime}</label>
      <output htmlFor="demo-time">{t.historyAgo(minutes)}</output>
      <button type="button" className="location-button" onClick={() => onChange(0)}>{t.resetTime}</button>
    </div>
    <input id="demo-time" type="range" min="-360" max="0" step="15" value={-minutes}
      aria-valuetext={t.historyAgo(minutes)} onChange={(event) => onChange(-Number(event.target.value))} />
    <div className="history-endpoints"><span>{t.historyAgo(360)}</span><span>{t.historyAgo(0)}</span></div>
    <p>{t.historyHint}</p>
  </section>
}
