import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { readTheme, saveTheme, type ThemeChoice } from '../lib/theme'

/** Alterna claro/escuro e guarda a escolha neste aparelho. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : document.documentElement.dataset.theme === 'dark' ? 'dark' : readTheme()))
  const next: ThemeChoice = theme === 'dark' ? 'light' : 'dark'
  return (
    <button className="theme-toggle" type="button" onClick={() => { saveTheme(next); setTheme(next) }} aria-label={`Mudar para o tema ${next === 'light' ? 'claro' : 'escuro'}`} title={`Tema ${next === 'light' ? 'claro' : 'escuro'}`}>
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
