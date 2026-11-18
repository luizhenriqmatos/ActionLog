export type ThemeChoice = 'light' | 'dark'
export const THEME_KEY = 'scouthouse.theme'

const isChoice = (value: unknown): value is ThemeChoice => value === 'light' || value === 'dark'

/**
 * Preferência salva vence sempre. Sem ela, claro — é o padrão do design
 * aprovado pelo diretor.
 *
 * Mudou em relação à versão anterior, que caía em escuro: só o caso SEM
 * preferência salva mudou. Quem já escolheu escuro continua no escuro, porque
 * `stored` é lido antes de qualquer outra coisa.
 */
export function resolveTheme(stored: string | null, _prefersLight: boolean | null): ThemeChoice {
  if (isChoice(stored)) return stored
  return 'light'
}

export function readTheme(): ThemeChoice {
  let stored: string | null = null
  try { stored = localStorage.getItem(THEME_KEY) } catch { /* sem armazenamento */ }
  const prefersLight = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)').matches : null
  return resolveTheme(stored, prefersLight)
}

export function applyTheme(theme: ThemeChoice) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#131316')
}

export function saveTheme(theme: ThemeChoice) {
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* a preferência vale só nesta sessão */ }
  applyTheme(theme)
}
