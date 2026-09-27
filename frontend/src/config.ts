// Match the server's DEMO_MODE. Vite reads this setting when it builds the app.
export const demoMode = import.meta.env.VITE_DEMO_MODE === 'true'
// Optional Google Map ID (a vector map). With it, the map turns and tilts to face your direction on a trip.
export const mapId: string | undefined = import.meta.env.VITE_GOOGLE_MAP_ID || undefined
