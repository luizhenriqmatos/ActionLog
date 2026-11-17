export type ThemeChoice = 'light' | 'dark'
export const THEME_KEY = 'scouthouse.theme'

const isChoice = (value: unknown): value is ThemeChoice => value === 'light' || value === 'dark'

/** Preferência salva; sem ela, o que o aparelho pede (prefers-color-scheme); sem os dois, escuro (a cara atual do app). */
export function resolveTheme(stored: string | null, prefersLight: boolean | null): ThemeChoice {
  if (isChoice(stored)) return stored
  if (prefersLight === true) return 'light'
  return 'dark'
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
