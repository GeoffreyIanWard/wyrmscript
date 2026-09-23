import '@fontsource/silkscreen/400.css'
import '@fontsource/silkscreen/700.css'
import '@fontsource/courier-prime/400.css'
import '@fontsource/courier-prime/400-italic.css'
import '@fontsource/courier-prime/700.css'
// F-15 (Manuscript palette only): a Fraktur display face for the illuminated
// capital and chrome, and Cardo for body prose — the request was explicit that
// the prose stay readable, so the two are deliberately different faces.
import '@fontsource/unifrakturmaguntia/400.css'
import '@fontsource/cardo/400.css'
import '@fontsource/cardo/400-italic.css'
import '@fontsource/cardo/700.css'
import './styles/retro.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
