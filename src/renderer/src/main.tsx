import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initLibraryEvents } from './stores/libraryStore'
import { initThumbEvents } from './lib/thumbEvents'
import './styles/global.css'

initLibraryEvents()
initThumbEvents()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
