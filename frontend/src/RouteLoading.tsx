import { useI18n } from './i18n'

export function RouteLoading() {
  const { t } = useI18n()
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-atomic="true">
      <span className="route-loading-spinner" aria-hidden="true" />
      <div>
        <strong>{t.findingRoutes}</strong>
        <p>{t.routeLoadingHint}</p>
      </div>
    </div>
  )
}
