import { App } from './ui/App'
import { DefaultCatalog } from './app/catalog/DefaultCatalog'
import { CompositeCatalog, loadRemoteProducts } from './app/catalog/RemoteCatalog'

declare global {
  interface Window {
    __app?: App
  }
}

// Guarda anti-doble-instancia: si un HMR re-ejecuta este módulo sobre una
// página viva, no montamos una segunda App (listeners y guardados duplicados).
if (!window.__app) {
  const remote = await loadRemoteProducts()
  window.__app = new App(
    document,
    new CompositeCatalog(new DefaultCatalog().items(), remote),
  )
}
