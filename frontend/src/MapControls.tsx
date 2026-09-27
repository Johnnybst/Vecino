import { useState } from 'react'
import type { ReactNode } from 'react'
import { HazardsLayer } from './HazardsLayer'
import type { Hazard } from './HazardsLayer'
import { IncidentsLayer } from './IncidentsLayer'
import { SeverityLegend } from './SeverityLegend'
import { TimeSlider } from './TimeSlider'
import { useI18n } from './i18n'

type Help = 'traffic' | 'incidents' | 'reports'

export function MapControls({ traffic, onTraffic, incidents, onIncidents, history, onHistory,
  minutes, onMinutes, at, onHazardsChange }: {
  traffic: boolean; onTraffic: (enabled: boolean) => void
  incidents: boolean; onIncidents: (enabled: boolean) => void
  history: boolean; onHistory: (enabled: boolean) => void
  minutes: number; onMinutes: (minutes: number) => void
  at?: string; onHazardsChange: (hazards: Hazard[]) => void
}) {
  const { t } = useI18n()
  const [help, setHelp] = useState<Help | null>(null)

  function control(kind: Help, label: string, content: ReactNode, checked?: boolean,
    onChange?: (checked: boolean) => void) {
    const id = `map-help-${kind}`
    return <div className="layer-control"
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHelp(kind) }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHelp(null) }}
      onFocusCapture={(event) => { if (event.target.matches(':focus-visible')) setHelp(kind) }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHelp(null) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { setHelp(null); event.stopPropagation() } }}>
      {onChange ? <label><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}
        aria-describedby={help === kind ? id : undefined} />{label}</label> : <span className="reports-label">{label}</span>}
      <button type="button" className="info-button" aria-label={t.aboutLayer(label)}
        aria-expanded={help === kind} aria-controls={id}
        onClick={() => setHelp(help === kind ? null : kind)}>ⓘ</button>
      <div id={id} className="layer-help" role="tooltip" hidden={help !== kind}>{content}</div>
    </div>
  }

  return <div className="panel-map-controls">
    <div className="layer-options">
      {control('traffic', t.traffic, <p>{t.trafficHelp}</p>, traffic, onTraffic)}
      {control('incidents', t.incidents, <>
        <p>{t.incidentsHelp}</p>
        {incidents ? <IncidentsLayer /> : <p>{t.incidentsNotice}</p>}
      </>, incidents, onIncidents)}
      {control('reports', t.reportsHelpLabel, <>
        <p>{t.reportColorsHelp}</p><SeverityLegend />
        <HazardsLayer key={at ?? 'now'} at={at} preview={!!at} onHazardsChange={onHazardsChange} />
      </>)}
    </div>
    <label className="history-toggle"><input type="checkbox" checked={history}
      onChange={(event) => onHistory(event.target.checked)} aria-controls="report-history" />{t.historyLabel}</label>
    {history && <div id="report-history"><TimeSlider minutes={minutes} onChange={onMinutes} /></div>}
  </div>
}
