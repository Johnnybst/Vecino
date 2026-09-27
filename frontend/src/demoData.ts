// Synthetic drawing examples only; these are not directions for a real trip.
import { messages } from './i18n'
import savedRoute from './sampleRoute.json'
type Position = [number, number]

function circle(lng: number, lat: number): Position[] {
  const points: Position[] = []
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * 2 * Math.PI
    points.push([
      lng + (250 * Math.cos(angle)) / (111320 * Math.cos(lat * Math.PI / 180)),
      lat + (250 * Math.sin(angle)) / 111320,
    ])
  }
  points.push(points[0])
  return points
}

export const demoHazards = {
  type: 'FeatureCollection',
  features: [-80.2197].map((lng, index) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [circle(lng, 25.7653)] },
    properties: {
      id: `hz_${index + 1}`,
      summary: messages.en.sampleSummary,
      reported_at: new Date(Date.now() - 10 * 60000).toISOString(),
      confidence: 0.8,
      report_count: 2,
      weight: 0.8 * Math.exp(-10 / 90),
      synthetic: true,
    },
  })),
}

export const demoRoute = {
  safe: { ...savedRoute.safe, geometry: { ...savedRoute.safe.geometry,
    coordinates: savedRoute.safe.geometry.coordinates as Position[] } },
  normal: { ...savedRoute.normal, geometry: { ...savedRoute.normal.geometry,
    coordinates: savedRoute.normal.geometry.coordinates as Position[] } },
  extra_minutes: savedRoute.extra_minutes,
  explanation: {
    en: messages.en.sampleExplanation,
    es: messages.es.sampleExplanation,
    ht: messages.ht.sampleExplanation,
  },
  left_out: [],
}
