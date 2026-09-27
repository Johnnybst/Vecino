// Light / dark mode: remembers the choice on this device, otherwise follows the phone's setting.
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'vecino-theme'

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage blocked: fall back to the phone's setting */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* not saved; still applied */ }
}

// Google's "night" map colors (classic JSON styling, works without a map ID).
type MapStyle = { featureType?: string; elementType?: string; stylers: { color: string }[] }

export const darkMapStyles: MapStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1f2630' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1f2630' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a96a3' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c9d3dc' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#9aa6b2' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1e3329' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a7c' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#333d49' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a2129' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#a3aebb' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a5563' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1a2129' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#d6dde4' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2a333e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1c2b' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4f6275' }] },
]
