import { createContext, useContext } from 'react'

export type Language = 'en' | 'es' | 'ht'
export const languageNames: Record<Language, string> = { en: 'English', es: 'Español', ht: 'Kreyòl' }

const en = {
  language: 'Language', mapLabel: 'Map of Miami', chooseTrip: 'Choose your trip',
  whereGoing: 'Where are you going?', from: 'From', to: 'To',
  originPlaceholder: 'Starting address', destinationPlaceholder: 'Destination address',
  loadingAddress: 'Loading address search...', checkingAddress: 'Checking address...',
  addressSelected: 'Address selected.', addressUnavailable: 'Address search is unavailable. Please try again.',
  chooseAnotherAddress: 'Please choose another address from the suggestions.',
  useLocation: 'Use my location', locating: 'Finding your location...', locationSelected: 'Current location selected',
  cancelLocation: 'Cancel and type an address', useAddress: 'Use an address instead',
  locationUnavailable: 'Location is unavailable in this browser. Please type an address.',
  locationDenied: 'Location permission was not granted. Please type an address.',
  locationFailed: 'Could not find your location. Please type an address or try again.',
  travelBy: 'Travel by', drive: 'Drive', walk: 'Walk', bike: 'Bike',
  tripSelected: 'Start and destination selected.', chooseAddresses: 'Choose your start and destination.',
  findRoutes: 'Find routes', findingRoutes: 'Finding routes...', cancel: 'Cancel',
  reselectAddresses: 'Please choose both addresses again.',
  routesUnavailable: 'Routes are unavailable. Check the server setup or try again.',
  routeIncomplete: 'The server returned an incomplete route. Please try again.',
  routeStopped: 'The route request stopped. You can try again.',
  serverUnavailable: 'Could not reach the route server. Check that it is running.',
  showSample: 'Show sample circles and routes', back: 'Back', editTrip: 'Edit trip',
  sampleMap: 'Sample map', yourRoutes: 'Your routes',
  sampleComparison: 'Sample route comparison', routeComparison: 'Your route comparison',
  sampleNotice: 'Demo only · Not directions for your selected trip',
  routeNotice: 'Real routes · Synthetic reports for the demo',
  samePath: 'The two routes follow the same path.',
  leftOut: 'Some reported areas near your start or destination could not be avoided.',
  legend: 'Map legend', detour: 'Detour', usualRoute: 'Usual route', reportedArea: 'Reported area',
  sampleArea: 'Sample reported area', activityDemo: 'Reported activity · Demo',
  syntheticNotice: 'Synthetic reports for the demo.', sampleDataNotice: 'Made-up data for this demo.',
  sampleSummary: 'Synthetic reports near Little Havana',
  loadingReports: 'Loading demo reports...',
  reportsUnavailable: 'Reports unavailable. Check that the server is running; retrying automatically.',
  missingKey: 'Add VITE_GOOGLE_MAPS_KEY to frontend/.env, then restart the app.',
  reportsStatus: (n: number) => `Demo reports: ${n} ${n === 1 ? 'area' : 'areas'}. Refreshes every minute.`,
  areaReports: (n: number) => `${n} ${n === 1 ? 'report' : 'reports'} in this area`,
  reportsNear: (n: number, place: string) => `${n} ${n === 1 ? 'report' : 'reports'} near ${place}`,
  reportAge: (n: number) => `Reported ${n} min ago`,
  confidence: (n: number) => `Confidence: ${n >= 0.7 ? 'High' : n >= 0.4 ? 'Medium' : 'Low'}`,
  routeHeadline: (minutes: number, areas: number) => `+${minutes} min · avoids ${areas} reported ${areas === 1 ? 'area' : 'areas'}`,
  routeDetails: (minutes: number, km: number) => `Detour: ${minutes} min · ${km.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`,
  sampleExplanation: 'This sample detour adds 6 minutes and avoids 2 reported areas containing 2 reports.',
}

type Messages = typeof en
export type TextKey = { [K in keyof Messages]: Messages[K] extends string ? K : never }[keyof Messages]

const es: Messages = {
  language: 'Idioma', mapLabel: 'Mapa de Miami', chooseTrip: 'Elige tu viaje',
  whereGoing: '¿Adónde vas?', from: 'Desde', to: 'Hasta',
  originPlaceholder: 'Dirección de salida', destinationPlaceholder: 'Dirección de destino',
  loadingAddress: 'Cargando búsqueda de direcciones...', checkingAddress: 'Comprobando dirección...',
  addressSelected: 'Dirección seleccionada.', addressUnavailable: 'La búsqueda no está disponible. Inténtalo de nuevo.',
  chooseAnotherAddress: 'Elige otra dirección de las sugerencias.',
  useLocation: 'Usar mi ubicación', locating: 'Buscando tu ubicación...', locationSelected: 'Ubicación actual seleccionada',
  cancelLocation: 'Cancelar y escribir una dirección', useAddress: 'Usar una dirección',
  locationUnavailable: 'La ubicación no está disponible en este navegador. Escribe una dirección.',
  locationDenied: 'No se concedió permiso de ubicación. Escribe una dirección.',
  locationFailed: 'No se pudo encontrar tu ubicación. Escribe una dirección o inténtalo de nuevo.',
  travelBy: 'Viajar en', drive: 'Auto', walk: 'A pie', bike: 'Bici',
  tripSelected: 'Salida y destino seleccionados.', chooseAddresses: 'Elige tu salida y destino.',
  findRoutes: 'Buscar rutas', findingRoutes: 'Buscando rutas...', cancel: 'Cancelar',
  reselectAddresses: 'Vuelve a elegir ambas direcciones.',
  routesUnavailable: 'Las rutas no están disponibles. Revisa el servidor o inténtalo de nuevo.',
  routeIncomplete: 'El servidor devolvió una ruta incompleta. Inténtalo de nuevo.',
  routeStopped: 'Se detuvo la búsqueda de rutas. Puedes intentarlo de nuevo.',
  serverUnavailable: 'No se pudo conectar con el servidor de rutas. Comprueba que esté funcionando.',
  showSample: 'Ver círculos y rutas de ejemplo', back: 'Volver', editTrip: 'Editar viaje',
  sampleMap: 'Mapa de ejemplo', yourRoutes: 'Tus rutas',
  sampleComparison: 'Comparación de rutas de ejemplo', routeComparison: 'Comparación de tus rutas',
  sampleNotice: 'Solo demostración · No son indicaciones para tu viaje',
  routeNotice: 'Rutas reales · Reportes ficticios para la demostración',
  samePath: 'Las dos rutas siguen el mismo camino.',
  leftOut: 'No se pudieron evitar algunas zonas reportadas cerca de tu salida o destino.',
  legend: 'Leyenda del mapa', detour: 'Desvío', usualRoute: 'Ruta habitual', reportedArea: 'Zona reportada',
  sampleArea: 'Zona reportada de ejemplo', activityDemo: 'Actividad reportada · Demostración',
  syntheticNotice: 'Reportes ficticios para la demostración.', sampleDataNotice: 'Datos ficticios para esta demostración.',
  sampleSummary: 'Reportes ficticios cerca de Little Havana',
  loadingReports: 'Cargando reportes de demostración...',
  reportsUnavailable: 'Reportes no disponibles. Comprueba el servidor; se reintentará automáticamente.',
  missingKey: 'Añade VITE_GOOGLE_MAPS_KEY a frontend/.env y reinicia la aplicación.',
  reportsStatus: (n) => `Reportes de demostración: ${n} ${n === 1 ? 'zona' : 'zonas'}. Se actualizan cada minuto.`,
  areaReports: (n) => `${n} ${n === 1 ? 'reporte' : 'reportes'} en esta zona`,
  reportsNear: (n, place) => `${n} ${n === 1 ? 'reporte' : 'reportes'} cerca de ${place}`,
  reportAge: (n) => `Reportado hace ${n} min`,
  confidence: (n) => `Confianza: ${n >= 0.7 ? 'Alta' : n >= 0.4 ? 'Media' : 'Baja'}`,
  routeHeadline: (minutes, areas) => `+${minutes} min · evita ${areas} ${areas === 1 ? 'zona reportada' : 'zonas reportadas'}`,
  routeDetails: (minutes, km) => `Desvío: ${minutes} min · ${km.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`,
  sampleExplanation: 'Este desvío de ejemplo añade 6 minutos y evita 2 zonas con 2 reportes de actividad.',
}

const ht: Messages = {
  language: 'Lang', mapLabel: 'Kat Miami', chooseTrip: 'Chwazi vwayaj ou',
  whereGoing: 'Ki kote ou prale?', from: 'Depa', to: 'Destinasyon',
  originPlaceholder: 'Adrès depa', destinationPlaceholder: 'Adrès destinasyon',
  loadingAddress: 'Rechèch adrès ap chaje...', checkingAddress: 'N ap verifye adrès la...',
  addressSelected: 'Adrès la chwazi.', addressUnavailable: 'Rechèch adrès la pa disponib. Eseye ankò.',
  chooseAnotherAddress: 'Chwazi yon lòt adrès nan sijesyon yo.',
  useLocation: 'Sèvi ak kote mwen ye', locating: 'N ap chèche kote ou ye...', locationSelected: 'Kote ou ye a chwazi',
  cancelLocation: 'Anile epi ekri yon adrès', useAddress: 'Sèvi ak yon adrès pito',
  locationUnavailable: 'Navigatè sa a pa ka jwenn kote ou ye. Ekri yon adrès.',
  locationDenied: 'Ou pa bay pèmisyon pou jwenn kote ou ye. Ekri yon adrès.',
  locationFailed: 'Nou pa jwenn kote ou ye. Ekri yon adrès oswa eseye ankò.',
  travelBy: 'Mwayen transpò', drive: 'Machin', walk: 'A pye', bike: 'Bisiklèt',
  tripSelected: 'Depa ak destinasyon chwazi.', chooseAddresses: 'Chwazi depa ak destinasyon ou.',
  findRoutes: 'Chèche wout', findingRoutes: 'N ap chèche wout...', cancel: 'Anile',
  reselectAddresses: 'Chwazi toude adrès yo ankò.',
  routesUnavailable: 'Wout yo pa disponib. Verifye sèvè a oswa eseye ankò.',
  routeIncomplete: 'Sèvè a retounen yon wout ki pa konplè. Eseye ankò.',
  routeStopped: 'Rechèch wout la sispann. Ou ka eseye ankò.',
  serverUnavailable: 'Nou pa ka konekte ak sèvè wout la. Verifye li ap mache.',
  showSample: 'Gade sèk ak wout egzanp yo', back: 'Retounen', editTrip: 'Modifye vwayaj',
  sampleMap: 'Kat egzanp', yourRoutes: 'Wout ou yo',
  sampleComparison: 'Konparezon wout egzanp yo', routeComparison: 'Konparezon wout ou yo',
  sampleNotice: 'Demonstrasyon sèlman · Se pa enstriksyon pou vwayaj ou',
  routeNotice: 'Wout reyèl · Rapò fiktif pou demonstrasyon an',
  samePath: 'Toude wout yo pase menm kote.',
  leftOut: 'Nou pa t kapab evite kèk zòn rapòte toupre depa oswa destinasyon ou.',
  legend: 'Senbòl kat la', detour: 'Detou', usualRoute: 'Wout nòmal', reportedArea: 'Zòn rapòte',
  sampleArea: 'Egzanp zòn rapòte', activityDemo: 'Aktivite rapòte · Demonstrasyon',
  syntheticNotice: 'Rapò fiktif pou demonstrasyon an.', sampleDataNotice: 'Done fiktif pou demonstrasyon sa a.',
  sampleSummary: 'Rapò fiktif toupre Little Havana',
  loadingReports: 'N ap chaje rapò demonstrasyon yo...',
  reportsUnavailable: 'Rapò yo pa disponib. Verifye sèvè a; n ap eseye ankò otomatikman.',
  missingKey: 'Ajoute VITE_GOOGLE_MAPS_KEY nan frontend/.env epi rekòmanse aplikasyon an.',
  reportsStatus: (n) => `Rapò demonstrasyon: ${n} zòn. Yo mete ajou chak minit.`,
  areaReports: (n) => `${n} rapò nan zòn sa a`,
  reportsNear: (n, place) => `${n} rapò toupre ${place}`,
  reportAge: (n) => `Yo rapòte sa ${n} minit de sa`,
  confidence: (n) => `Konfyans: ${n >= 0.7 ? 'Wo' : n >= 0.4 ? 'Mwayen' : 'Ba'}`,
  routeHeadline: (minutes, areas) => `+${minutes} min · evite ${areas} zòn rapòte`,
  routeDetails: (minutes, km) => `Detou: ${minutes} min · ${km.toLocaleString('fr-HT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`,
  sampleExplanation: 'Detou egzanp sa a ajoute 6 minit epi li evite 2 zòn ki gen 2 rapò aktivite.',
}

export const messages: Record<Language, Messages> = { en, es, ht }

// Translate the server's fixed summary prefix; preserve place names and free text.
export function reportSummary(summary: string, count: number, language: Language) {
  const match = /^\d+ reports? near (.+)$/.exec(summary)
  return match ? messages[language].reportsNear(count, match[1]) : summary
}
export const I18nContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({
  language: 'en', setLanguage: () => {},
})

export function useI18n() {
  const context = useContext(I18nContext)
  return { ...context, t: messages[context.language] }
}
