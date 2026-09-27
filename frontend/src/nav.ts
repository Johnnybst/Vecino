// Navigation math on a [lng, lat] route line (flat-earth is fine at city scale).
export type Point = [number, number]
export type Progress = { index: number; point: Point; offRouteM: number }

function metres(a: Point, b: Point) {
  const x = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180)
  const y = (b[1] - a[1]) * 111320
  return Math.hypot(x, y)
}

// Closest spot on the line: which segment (index = its start point), where on it, and how far away.
export function progressOnLine(spot: { lat: number; lng: number }, line: Point[]): Progress {
  const kx = 111320 * Math.cos(spot.lat * Math.PI / 180), ky = 111320
  let best: Progress = { index: 0, point: line[0], offRouteM: Infinity }
  for (let i = 1; i < line.length; i += 1) {
    const ax = (line[i - 1][0] - spot.lng) * kx, ay = (line[i - 1][1] - spot.lat) * ky
    const bx = (line[i][0] - spot.lng) * kx, by = (line[i][1] - spot.lat) * ky
    const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy
    const t = lengthSq ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0
    const distance = Math.hypot(ax + t * dx, ay + t * dy)
    if (distance < best.offRouteM) {
      best = { index: i - 1, offRouteM: distance, point: [
        line[i - 1][0] + t * (line[i][0] - line[i - 1][0]),
        line[i - 1][1] + t * (line[i][1] - line[i - 1][1])] }
    }
  }
  return best
}

// Distance along the line from where you are to point `toIndex` (the end of the line by default).
export function metresAhead(line: Point[], progress: Progress, toIndex = line.length - 1) {
  if (toIndex <= progress.index) return 0
  let total = metres(progress.point, line[progress.index + 1])
  for (let i = progress.index + 1; i < toIndex; i += 1) total += metres(line[i], line[i + 1])
  return total
}

// The part of the route still ahead: from your spot to the end.
export function lineAhead(line: Point[], progress: Progress): Point[] {
  return [progress.point, ...line.slice(progress.index + 1)]
}

// Compass direction (0 = north, 90 = east) the route heads from where you are, looking ~40 m ahead.
export function headingAhead(line: Point[], progress: Progress, lookM = 40): number {
  let from = progress.point, to = line[Math.min(progress.index + 1, line.length - 1)]
  let travelled = metres(from, to)
  for (let i = progress.index + 1; travelled < lookM && i < line.length - 1; i += 1) {
    travelled += metres(line[i], line[i + 1])
    to = line[i + 1]
  }
  if (to === from) from = line[Math.max(0, progress.index)]
  const dx = (to[0] - from[0]) * Math.cos(from[1] * Math.PI / 180), dy = to[1] - from[1]
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360
}
