import type { Hazard } from './HazardsLayer'

// low = Observed (green, warning only), medium = Moderate, high = Critical.
export const severityColors = { low: '#2E8B57', medium: '#E0702A', high: '#D0342C' }
export type Severity = keyof typeof severityColors
export const severitySymbols = { low: '●', medium: '◆', high: '▲' }

export function reportSeverity(properties: Hazard['properties']): Severity {
  return properties.severity ?? (properties.confidence >= 0.85 || properties.report_count >= 4
    ? 'high' : properties.report_count >= 2 ? 'medium' : 'low')
}

export function reportColor(properties: Hazard['properties'], at: number) {
  const base = severityColors[reportSeverity(properties)]
  const ageMinutes = Math.max(0, (at - Date.parse(properties.reported_at)) / 60000)
  // Grays over the level's own lifetime (Observed 3 h, Moderate and Critical 6 h), then stays grayed.
  const blend = Math.min(ageMinutes / (reportSeverity(properties) === 'low' ? 180 : 360), 1) * 0.75
  const channels = [1, 3, 5].map((start) => {
    const channel = parseInt(base.slice(start, start + 2), 16)
    return Math.round(channel + (158 - channel) * blend).toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}
