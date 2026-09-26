import type { Hazard } from './HazardsLayer'

type RouteLine = {
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  duration_s: number
  distance_m: number
}

export type RouteResponse = {
  safe: RouteLine & { hazards_avoided: string[] }
  normal: RouteLine & { hazards_crossed: string[] }
  extra_minutes: number
  explanation: { en: string; es: string; ht: string }
  left_out: string[]
  endpoint_reports?: { origin: string[]; destination: string[] }
}

export type RouteResult = { data: RouteResponse; hazards: Hazard[] }

function isLine(value: unknown): value is RouteLine {
  if (!value || typeof value !== 'object') return false
  const line = value as RouteLine
  return line.geometry?.type === 'LineString'
    && Array.isArray(line.geometry.coordinates) && line.geometry.coordinates.length >= 2
    && line.geometry.coordinates.every((point) => Array.isArray(point) && point.length >= 2
      && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180
      && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90)
    && Number.isFinite(line.duration_s) && line.duration_s >= 0
    && Number.isFinite(line.distance_m) && line.distance_m >= 0
}

const isIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'string')

export function isRouteResponse(value: unknown): value is RouteResponse {
  if (!value || typeof value !== 'object') return false
  const route = value as RouteResponse
  return isLine(route.safe) && isLine(route.normal)
    && isIds(route.safe.hazards_avoided) && isIds(route.normal.hazards_crossed)
    && Number.isFinite(route.extra_minutes) && route.extra_minutes >= 0
    && typeof route.explanation?.en === 'string'
    && typeof route.explanation?.es === 'string'
    && typeof route.explanation?.ht === 'string'
    && isIds(route.left_out)
    && (route.endpoint_reports === undefined || (
      !!route.endpoint_reports && isIds(route.endpoint_reports.origin)
      && isIds(route.endpoint_reports.destination)))
}
