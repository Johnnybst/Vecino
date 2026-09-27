import { useEffect } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'

export type MapShape = {
  id: string
  rings: [number, number][][]
  color: string
  fillOpacity?: number
  // Google-style alternate route: wide, soft and see-through, drawn under the main one.
  muted?: boolean
  // Redrawn often (the route shrinking as you move): skip the draw-in animation.
  still?: boolean
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
      // Muted lines get a darker outline so they stay visible on Google's gray main roads.
      const casing = shape.muted ? document.createElementNS('http://www.w3.org/2000/svg', 'path') : null
      if (casing) {
        casing.setAttribute('stroke', '#5f6368')
        casing.setAttribute('stroke-opacity', '0.75')
        casing.setAttribute('stroke-width', '9')
        casing.setAttribute('fill', 'none')
        casing.setAttribute('stroke-linejoin', 'round')
        casing.setAttribute('stroke-linecap', 'round')
        casing.setAttribute('class', 'usual-shape')
        svg.appendChild(casing)
      }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.dataset.shapeId = shape.id
      path.setAttribute('stroke', shape.color)
      path.setAttribute('stroke-width', polygons ? '2' : shape.muted ? '5' : '6')
      if (shape.muted) path.setAttribute('stroke-opacity', '0.9')
      path.setAttribute('fill', polygons ? shape.color : 'none')
      path.setAttribute('fill-opacity', String(shape.fillOpacity ?? 0))
      path.setAttribute('fill-rule', 'evenodd')
      path.setAttribute('stroke-linejoin', 'round')
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('class', polygons ? 'report-shape' : shape.muted ? 'usual-shape'
        : shape.still ? 'route-shape no-draw' : 'route-shape')
      if (!polygons && !shape.muted) path.setAttribute('pathLength', '1')
      svg.appendChild(path)
      return { path, casing }
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
        paths[index].path.setAttribute('d', d)
        paths[index].casing?.setAttribute('d', d)
      })
    }
    overlay.onRemove = () => svg.remove()
    overlay.setMap(map)
    return () => overlay.setMap(null)
  }, [map, maps, core, shapes, polygons])
  return null
}
