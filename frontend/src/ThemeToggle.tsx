import { useI18n } from './i18n'
import type { Theme } from './theme'

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const { t } = useI18n()
  const dark = theme === 'dark'
  return (
    <button type="button" className="location-button theme-toggle" aria-pressed={dark}
      aria-label={dark ? t.lightMode : t.darkMode} title={dark ? t.lightMode : t.darkMode}
      onClick={() => onChange(dark ? 'light' : 'dark')}>
      <span aria-hidden="true">{dark ? '☀' : '☾'}</span>
    </button>
  )
}
