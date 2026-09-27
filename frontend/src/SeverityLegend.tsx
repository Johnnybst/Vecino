import { useI18n } from './i18n'
import { severityColors, severitySymbols } from './reportStyle'

export function SeverityLegend() {
  const { t } = useI18n()
  return <ul className="map-legend severity-legend" aria-label={t.reportLevels}>
    {(['low', 'medium', 'high'] as const).map((level) => <li key={level}>
      <span className="severity-icon" style={{ color: severityColors[level] }} aria-hidden="true">{severitySymbols[level]}</span>
      {t.severityLabels[level]}
    </li>)}
  </ul>
}
