// Light / dark mode. "auto" follows the time of day; a tapped choice is remembered on this device.
export type Theme = 'light' | 'dark'
export type ThemeChoice = 'auto' | Theme

const STORAGE_KEY = 'vecino-theme'
// Miami's sunset/sunrise are close to 7 PM / 7 AM for much of the year.
const DARK_FROM_HOUR = 19
const LIGHT_FROM_HOUR = 7

export function initialChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'auto' || saved === 'light' || saved === 'dark') return saved
  } catch { /* storage blocked: use auto */ }
  return 'auto'
}

export function saveChoice(choice: ThemeChoice) {
  try { localStorage.setItem(STORAGE_KEY, choice) } catch { /* not saved; still applied */ }
}

export function resolveTheme(choice: ThemeChoice, now: Date): Theme {
  if (choice !== 'auto') return choice
  const hour = now.getHours()
  return hour >= DARK_FROM_HOUR || hour < LIGHT_FROM_HOUR ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

type MapStyle = { featureType?: string; elementType?: string; stylers: { color: string }[] }

// Google's "night" map colors (classic JSON styling, works without a map ID).
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
