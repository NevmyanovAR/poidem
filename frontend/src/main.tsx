import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/manrope/cyrillic-400.css'
import '@fontsource/manrope/cyrillic-500.css'
import '@fontsource/manrope/cyrillic-600.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/forum/cyrillic-400.css'
import '@fontsource/forum/latin-400.css'
import App from './App'
import { ApiProvider } from './state/ApiProvider'
import './theme.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter><ApiProvider><App /></ApiProvider></BrowserRouter>
  </React.StrictMode>,
)
