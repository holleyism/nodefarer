import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import App from './App'
import HyperbolicPOC from './hyperbolic/HyperbolicPOC'
import Hyperbolic3DPOC from './hyperbolic/Hyperbolic3DPOC'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7fd4ff' },
    background: { default: '#02030a', paper: '#0a101f' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
})

// Isolated, throwaway experiment: ?poc=hyperbolic mounts the 2D Poincaré-disk
// egocentric POC instead of the main app (memory hyperbolic-poc-plan).
const poc = new URLSearchParams(window.location.search).get('poc')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {poc === 'hyperbolic3d' ? <Hyperbolic3DPOC /> : poc === 'hyperbolic' ? <HyperbolicPOC /> : <App />}
    </ThemeProvider>
  </StrictMode>,
)
