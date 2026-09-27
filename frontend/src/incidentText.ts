import { messages } from './i18n'
import type { Language } from './i18n'

// Clean the feed's location notation without changing its incident details.
export function incidentText(description: string, language: Language): string {
  const words = messages[language].incidentLocation
  const terms: Record<string, string> = words
  return description
    .replace(/\[(NOF|SOF|EOF|WOF)\]\s*x\[/gi, (_, code: string) => `, ${terms[code.toUpperCase()]} [`)
    .replace(/\bx\[/gi, `${words.at} [`)
    .replace(/\]\s*\[/g, '], [')
    .replace(/\[|\]/g, '')
    .replace(/\b(\d+)(ST|ND|RD|TH)\b/g, (_, number: string, suffix: string) => number + suffix.toLowerCase())
    .replace(/\b(NOF|SOF|EOF|WOF|NB|SB|EB|WB|ST|AVE|RD|BLVD|TPKE|PKWY)\b/g,
      (term) => terms[term.toUpperCase()])
    .replace(/\bMM\s*(\d+)\b/gi, `${words.mileMarker} $1`)
    .replace(/\b[A-Z][A-Z']+\b/g, (word) => /^(?:NW|NE|SW|SE|US|SR|I)$/.test(word)
      ? word : word[0] + word.slice(1).toLowerCase())
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
}
