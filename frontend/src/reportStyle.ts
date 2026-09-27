import type { Hazard } from './HazardsLayer'

export const severityColors = { low: '#D4A017', medium: '#E0702A', high: '#D0342C' }
export type Severity = keyof typeof severityColors
export const severitySymbols = { low: '●', medium: '◆', high: '▲' }

export function reportSeverity(properties: Hazard['properties']): Severity {
  return properties.severity ?? (properties.confidence >= 0.85 || properties.report_count >= 4
    ? 'high' : properties.report_count >= 2 ? 'medium' : 'low')
}

export function reportColor(properties: Hazard['properties'], at: number) {
  const base = severityColors[reportSeverity(properties)]
  const ageMinutes = Math.max(0, (at - Date.parse(properties.reported_at)) / 60000)
  const blend = Math.min(ageMinutes / 180, 1) * 0.75
  const channels = [1, 3, 5].map((start) => {
    const channel = parseInt(base.slice(start, start + 2), 16)
    return Math.round(channel + (158 - channel) * blend).toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}
