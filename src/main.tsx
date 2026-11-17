import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PublicReport } from './components/PublicReport'
import './styles.css'

const reportToken = new URLSearchParams(window.location.search).get('r')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {reportToken ? <PublicReport token={reportToken} /> : <App />}
  </StrictMode>,
)
