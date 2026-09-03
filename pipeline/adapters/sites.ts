import type { SiteConfig } from '../core/types'

/** Configuraciones por sitio del scraper JSON-LD. Añadir sitio = añadir entrada. */
export const SITES: Record<string, SiteConfig> = {
  sklum: {
    id: 'sklum',
    country: 'es',
    origin: 'https://www.sklum.com',
    categoryUrls: [
      'https://www.sklum.com/es/3427-comprar-sillas-de-comedor',
      'https://www.sklum.com/es/633-comprar-sofas',
      'https://www.sklum.com/es/544-comprar-sillones',
      'https://www.sklum.com/es/12230-comprar-camas',
      'https://www.sklum.com/es/3976-comprar-mesitas-de-noche',
      'https://www.sklum.com/es/538-comprar-mesas-comedor',
      'https://www.sklum.com/es/539-comprar-mesas-bajas-y-auxiliares',
      'https://www.sklum.com/es/525-comprar-lamparas',
      'https://www.sklum.com/es/550-comprar-estanterias',
      'https://www.sklum.com/es/4057-comprar-aparadores',
    ],
    productLinkPattern: /^\/es\/comprar-[^"]+\.html$/,
  },
}
