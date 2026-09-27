import { useI18n } from './i18n'
import type { ThemeChoice } from './theme'

const NEXT: Record<ThemeChoice, ThemeChoice> = { auto: 'dark', dark: 'light', light: 'auto' }
const ICON: Record<ThemeChoice, string> = { auto: '◐', dark: '☾', light: '☀' }

// One button that cycles Auto (time of day) → Dark → Light.
export function ThemeToggle({ choice, onChange }: { choice: ThemeChoice; onChange: (choice: ThemeChoice) => void }) {
  const { t } = useI18n()
  const names = { auto: t.autoMode, dark: t.darkMode, light: t.lightMode }
  const label = t.themeLabel(names[choice], names[NEXT[choice]])
  return (
    <button type="button" className="location-button theme-toggle" aria-label={label} title={label}
      onClick={() => onChange(NEXT[choice])}>
      <span aria-hidden="true">{ICON[choice]}</span>
    </button>
  )
}
