import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMinBuild, isOutdated } from '../lib/versao'

/** Verdadeiro quando o servidor exige uma versão mais nova do app. Confere ao abrir, a cada 5 min e ao voltar para a aba. */
export function useOutdated() {
  const [outdated, setOutdated] = useState(false)
  useEffect(() => {
    if (!supabase) return
    let alive = true
    const check = () => fetchMinBuild(supabase).then((min) => { if (alive && isOutdated(min)) setOutdated(true) })
    check()
    const timer = window.setInterval(check, 5 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return outdated
}
