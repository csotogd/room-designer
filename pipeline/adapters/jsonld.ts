import type { ScrapedProduct } from '../core/types'

/**
 * Extracción de producto desde el JSON-LD (schema.org/Product) de una página.
 * Función pura: HTML dentro, producto fuera — testeable sin red.
 */

const DIMENSION_ALIASES: Record<string, 'widthCm' | 'depthCm' | 'heightCm'> = {
  ancho: 'widthCm',
  anchura: 'widthCm',
  width: 'widthCm',
  profundo: 'depthCm',
  profundidad: 'depthCm',
  fondo: 'depthCm',
  depth: 'depthCm',
  largo: 'depthCm',
  alto: 'heightCm',
  altura: 'heightCm',
  height: 'heightCm',
}

export function extractJsonLdProduct(
  html: string,
  sourceUrl: string,
  site: string,
): ScrapedProduct | null {
  for (const match of html.matchAll(
    /<script type="application\/ld\+json">(.*?)<\/script>/gs,
  )) {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(match[1]!)
    } catch {
      continue
    }
    if (data['@type'] !== 'Product') continue

    const name = typeof data.name === 'string' ? data.name : null
    let image = data.image
    if (Array.isArray(image)) image = image[0]
    if (!name || typeof image !== 'string') continue

    const product: ScrapedProduct = {
      id: idFromUrl(sourceUrl),
      site,
      sourceUrl,
      name,
      imageUrl: image,
      extraDims: {},
    }

    let offers = data.offers as Record<string, unknown> | Record<string, unknown>[] | undefined
    if (Array.isArray(offers)) offers = offers[0]
    if (offers) {
      const spec = (offers.priceSpecification ?? {}) as Record<string, unknown>
      const price = Number(offers.price ?? spec.price)
      if (Number.isFinite(price)) product.price = price
      const currency = offers.priceCurrency ?? spec.priceCurrency
      if (typeof currency === 'string') product.currency = currency
    }

    // Galería: todas las imágenes del CDN que comparten slug con la principal
    // (la principal suele ser un bodegón; el packshot está en la galería).
    const slug = image.split('/').pop()
    if (slug) {
      const gallery = new Set<string>()
      for (const m of html.matchAll(/https?:\/\/[^"'\s]+\/(\d+)(?:-[a-z_]+)?\/([^"'\s]+\.jpe?g)/g)) {
        if (m[2] === slug && !m[0].includes('-large_default')) gallery.add(m[0])
      }
      gallery.delete(image)
      if (gallery.size > 0) product.galleryUrls = [...gallery].slice(0, 8)
    }

    for (const property of (data.additionalProperty as Record<string, unknown>[]) ?? []) {
      if (property['@type'] !== 'QuantitativeValue') continue
      const rawName = String(property.name ?? '').toLowerCase().trim()
      const value = Number(String(property.value ?? '').replace(',', '.'))
      if (!Number.isFinite(value)) continue
      const alias = DIMENSION_ALIASES[rawName]
      if (alias && product[alias] === undefined) product[alias] = value
      else product.extraDims[rawName] = value
    }
    return product
  }
  return null
}

export function extractProductLinks(html: string, pattern: RegExp, origin: string): string[] {
  const seen = new Set<string>()
  const links: string[] = []
  for (const match of html.matchAll(new RegExp(`href="([^"]+)"`, 'g'))) {
    const href = match[1]!.split('?')[0]!
    if (!pattern.test(href) || seen.has(href)) continue
    seen.add(href)
    links.push(href.startsWith('http') ? href : origin + href)
  }
  return links
}

function idFromUrl(url: string): string {
  const slug = url.split('/').pop() ?? url
  return slug.replace(/\.html?$/, '').slice(0, 80)
}
