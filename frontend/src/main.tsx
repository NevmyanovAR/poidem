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
import { DemoProvider } from './state/DemoProvider'
import './theme.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter><DemoProvider><App /></DemoProvider></BrowserRouter>
  </React.StrictMode>,
)
