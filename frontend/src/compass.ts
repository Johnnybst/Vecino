// Which way the phone is facing (0 = north, 90 = east), from its compass. Stays on the device.

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number }
type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> }

// iPhone asks first; this must run inside a tap (Follow me / Start trip).
export async function askCompassPermission() {
  const request = (window.DeviceOrientationEvent as unknown as OrientationPermission | undefined)?.requestPermission
  if (!request) return
  try { await request() } catch { /* declined: the map falls back to the road's direction */ }
}

// Calls onFacing with the compass direction; returns a function that stops listening.
// Every reading is passed on; the map smooths them.
export function watchCompass(onFacing: (degrees: number) => void) {
  const handle = (event: Event) => {
    const e = event as IOSOrientationEvent
    const degrees = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading // iPhone
      : (e.absolute || event.type === 'deviceorientationabsolute') && typeof e.alpha === 'number'
        ? (360 - e.alpha) % 360 : null // Android (true north)
    if (degrees !== null && Number.isFinite(degrees)) onFacing(degrees)
  }
  // Listen to both: Android sends true-north readings on the "absolute" event, iPhone on the plain one.
  window.addEventListener('deviceorientationabsolute', handle)
  window.addEventListener('deviceorientation', handle)
  return () => {
    window.removeEventListener('deviceorientationabsolute', handle)
    window.removeEventListener('deviceorientation', handle)
  }
}
