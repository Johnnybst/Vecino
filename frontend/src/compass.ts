// Which way the phone is facing (0 = north, 90 = east), from its compass. Stays on the device.

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number }
type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> }

// iPhone asks first; this must run inside a tap (Follow me / Start trip).
export async function askCompassPermission() {
  const request = (window.DeviceOrientationEvent as unknown as OrientationPermission | undefined)?.requestPermission
  if (!request) return
  try { await request() } catch { /* declined: the beam just won't show */ }
}

// Calls onFacing with the compass direction; returns a function that stops listening.
export function watchCompass(onFacing: (degrees: number) => void) {
  let last = -1000
  let lastAt = 0
  const handle = (event: Event) => {
    const e = event as IOSOrientationEvent
    const degrees = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading // iPhone
      : e.absolute && typeof e.alpha === 'number' ? (360 - e.alpha) % 360 : null // Android
    if (degrees === null) return
    // A few updates a second is plenty, and skip tiny wobbles.
    const now = performance.now()
    const turned = Math.abs(((degrees - last + 540) % 360) - 180)
    if (now - lastAt < 200 || turned < 3) return
    last = degrees
    lastAt = now
    onFacing(degrees)
  }
  const absolute = 'ondeviceorientationabsolute' in window
  window.addEventListener(absolute ? 'deviceorientationabsolute' : 'deviceorientation', handle)
  return () => window.removeEventListener(absolute ? 'deviceorientationabsolute' : 'deviceorientation', handle)
}
