import type { SiteConfig } from '../core/types'

/**
 * Registro de fuentes de catálogo. Añadir fuente = añadir entrada.
 *  - kind 'jsonld':   scraper de tienda (schema.org/Product en JSON-LD).
 *  - kind 'polyhaven': API pública de Poly Haven — todo CC0, modelos glTF
 *    reales con dimensiones físicas; no requiere credenciales.
 *  - kind 'sketchfab': API pública de Sketchfab filtrada a licencias CC0 y
 *    CC-BY; descargar los GLB exige SKETCHFAB_API_TOKEN (cuenta gratuita).
 */
export const SITES: Record<string, SiteConfig> = {
  sklum: {
    id: 'sklum',
    kind: 'jsonld',
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
  polyhaven: {
    id: 'polyhaven',
    kind: 'polyhaven',
    country: 'int',
    origin: 'https://polyhaven.com',
  },
  sketchfab: {
    id: 'sketchfab',
    kind: 'sketchfab',
    country: 'int',
    origin: 'https://sketchfab.com',
  },
}

/** Sitio activo por defecto para CLIs y front: variable de entorno compartida. */
export function defaultSiteId(env: Record<string, string | undefined> = process.env): string {
  return env.CATALOG_SITE ?? 'sklum'
}
