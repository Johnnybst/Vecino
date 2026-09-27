// Synthetic drawing examples only; these are not directions for a real trip.
import { messages } from './i18n'
type Position = [number, number]

function circle(lng: number, lat: number): Position[] {
  const points: Position[] = []
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * 2 * Math.PI
    points.push([
      lng + (90 * Math.cos(angle)) / (111320 * Math.cos(lat * Math.PI / 180)),
      lat + (90 * Math.sin(angle)) / 111320,
    ])
  }
  points.push(points[0])
  return points
}

export const demoHazards = {
  type: 'FeatureCollection',
  features: [-80.228, -80.219].map((lng, index) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [circle(lng, 25.765)] },
    properties: {
      id: `hz_demo_${index + 1}`,
      summary: messages.en.sampleSummary,
      reported_at: new Date(Date.now() - 10 * 60000).toISOString(),
      confidence: 0.8,
      report_count: 1,
      weight: 0.8 * Math.exp(-10 / 90),
      synthetic: true,
    },
  })),
}

export const demoRoute = {
  safe: {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-80.236, 25.765], [-80.233, 25.765], [-80.233, 25.771],
        [-80.212, 25.771], [-80.212, 25.765],
      ] as Position[],
    },
    duration_s: 780,
    distance_m: 3800,
    hazards_avoided: ['hz_demo_1', 'hz_demo_2'],
  },
  normal: {
    geometry: {
      type: 'LineString',
      coordinates: [[-80.236, 25.765], [-80.212, 25.765]] as Position[],
    },
    duration_s: 420,
    distance_m: 2400,
    hazards_crossed: ['hz_demo_1', 'hz_demo_2'],
  },
  extra_minutes: 6,
  explanation: {
    en: messages.en.sampleExplanation,
    es: messages.es.sampleExplanation,
    ht: messages.ht.sampleExplanation,
  },
  left_out: [],
}
