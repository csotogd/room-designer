import type { SiteConfig } from '../core/types'

/** Configuraciones por sitio del scraper JSON-LD. Añadir sitio = añadir entrada. */
export const SITES: Record<string, SiteConfig> = {
  sklum: {
    id: 'sklum',
    origin: 'https://www.sklum.com',
    categoryUrls: [
      'https://www.sklum.com/es/3427-comprar-sillas-de-comedor',
      'https://www.sklum.com/es/527-comprar-mesas',
      'https://www.sklum.com/es/588-comprar-muebles-salon',
      'https://www.sklum.com/es/529-comprar-muebles-almacenaje',
      'https://www.sklum.com/es/593-comprar-muebles-dormitorio',
    ],
    productLinkPattern: /^\/es\/comprar-[^"]+\.html$/,
  },
}
