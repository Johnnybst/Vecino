import { languageNames, useI18n } from './i18n'
import type { Language } from './i18n'

export function LanguageSelect() {
  const { language, setLanguage, t } = useI18n()
  return (
    <label className="language-select">
      <span className="visually-hidden">{t.language}</span>
      <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
        {(Object.entries(languageNames) as [Language, string][]).map(([code, name]) => (
          <option key={code} value={code} lang={code}>{name}</option>
        ))}
      </select>
    </label>
  )
}
