import { Marker } from '@vis.gl/react-google-maps'
import { useI18n } from './i18n'

export function TripMarkers({ coordinates }: { coordinates: [number, number][] }) {
  const { t } = useI18n()
  const start = coordinates[0], end = coordinates[coordinates.length - 1]
  return <>
    <Marker position={{ lng: start[0], lat: start[1] }} title={t.from} zIndex={10}
      icon={{ path: 'M 0,0 C -3,-5 -9,-10 -9,-16 A 9,9 0 1,1 9,-16 C 9,-10 3,-5 0,0 Z',
        fillColor: '#24583d', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2, scale: 1 }} />
    <Marker position={{ lng: end[0], lat: end[1] }} title={t.to} zIndex={11}
      icon={{ path: 'M 0,0 L 0,-28 L 20,-28 L 15,-20 L 0,-20 Z',
        fillColor: '#24583d', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2, scale: 1 }} />
  </>
}
