import { useEffect } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'

export type MapShape = {
  id: string
  rings: [number, number][][]
  color: string
  fillOpacity?: number
  dashed?: boolean
}

// SVG follows Google's projection on pan/zoom; only CSS performs animations.
export function MapGeometry({ shapes, polygons = false }: { shapes: MapShape[]; polygons?: boolean }) {
  const map = useMap()
  const maps = useMapsLibrary('maps')
  const core = useMapsLibrary('core')
  useEffect(() => {
    if (!map || !maps || !core) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'map-geometry')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.zIndex = polygons ? '1' : '2'
    const paths = shapes.map((shape) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.dataset.shapeId = shape.id
      path.setAttribute('stroke', shape.color)
      path.setAttribute('stroke-width', polygons ? '2' : shape.dashed ? '4' : '6')
      path.setAttribute('fill', polygons ? shape.color : 'none')
      path.setAttribute('fill-opacity', String(shape.fillOpacity ?? 0))
      path.setAttribute('fill-rule', 'evenodd')
      path.setAttribute('stroke-linejoin', 'round')
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('class', polygons ? 'report-shape' : shape.dashed ? 'usual-shape' : 'route-shape')
      if (shape.dashed) path.setAttribute('stroke-dasharray', '9 9')
      else if (!polygons) path.setAttribute('pathLength', '1')
      svg.appendChild(path)
      return path
    })
    const overlay = new maps.OverlayView()
    overlay.onAdd = () => { overlay.getPanes()?.overlayLayer.appendChild(svg) }
    overlay.draw = () => {
      const projection = overlay.getProjection()
      shapes.forEach((shape, index) => {
        const d = shape.rings.map((ring) => ring.map(([lng, lat], pointIndex) => {
          const point = projection.fromLatLngToDivPixel(new core.LatLng(lat, lng))
          return point ? `${pointIndex === 0 ? 'M' : 'L'}${point.x},${point.y}` : ''
        }).join(' ') + (polygons ? ' Z' : '')).join(' ')
        paths[index].setAttribute('d', d)
      })
    }
    overlay.onRemove = () => svg.remove()
    overlay.setMap(map)
    return () => overlay.setMap(null)
  }, [map, maps, core, shapes, polygons])
  return null
}
