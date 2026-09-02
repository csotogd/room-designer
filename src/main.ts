import { App } from './ui/App'

declare global {
  interface Window {
    __app?: App
  }
}

// Guarda anti-doble-instancia: si un HMR re-ejecuta este módulo sobre una
// página viva, no montamos una segunda App (listeners y guardados duplicados).
if (!window.__app) {
  window.__app = new App(document)
}
