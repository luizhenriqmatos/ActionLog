import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PublicReport } from './components/PublicReport'
import { ClubSite } from './components/ClubSite'
import './styles.css'
import { applyTheme, readTheme } from './lib/theme'

applyTheme(readTheme())

const params = new URLSearchParams(window.location.search)
const reportToken = params.get('r')
/** Site público para clubes: ?site. Fora do aplicativo, sem login e sem dado de atleta. */
const isSite = params.has('site') || window.location.pathname === '/clubes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {reportToken ? <PublicReport token={reportToken} /> : isSite ? <ClubSite /> : <App />}
  </StrictMode>,
)
