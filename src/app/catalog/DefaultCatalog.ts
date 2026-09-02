import type { CatalogItem } from '../../core/model/CatalogItem'
import type { FurnitureCatalog } from './FurnitureCatalog'

const ITEMS: readonly CatalogItem[] = [
  { id: 'sofa', name: 'Sofá', width: 2.0, depth: 0.9, height: 0.8, isSurface: false, color: '#7c9885', price: 499 },
  { id: 'table', name: 'Mesa', width: 1.4, depth: 0.8, height: 0.75, isSurface: true, color: '#b08968', price: 199 },
  { id: 'chair', name: 'Silla', width: 0.5, depth: 0.52, height: 0.9, isSurface: false, color: '#9c6644', price: 49 },
  { id: 'bed', name: 'Cama', width: 1.6, depth: 2.0, height: 0.55, isSurface: true, color: '#8e9aaf', price: 399 },
  { id: 'wardrobe', name: 'Armario', width: 1.2, depth: 0.6, height: 2.0, isSurface: true, color: '#6b705c', price: 299 },
  { id: 'shelf', name: 'Estantería', width: 0.8, depth: 0.4, height: 1.8, isSurface: true, color: '#a68a64', price: 129 },
  { id: 'sideboard', name: 'Aparador', width: 1.6, depth: 0.45, height: 0.85, isSurface: true, color: '#936639', price: 249 },
  { id: 'vase', name: 'Jarrón', width: 0.2, depth: 0.2, height: 0.35, isSurface: false, color: '#4a7ba6', price: 12 },
  { id: 'plant', name: 'Planta', width: 0.4, depth: 0.4, height: 1.2, isSurface: false, color: '#52796f', price: 25 },
  { id: 'tv', name: 'Televisor', width: 1.2, depth: 0.08, height: 0.7, isSurface: false, color: '#22223b', price: 599 },
  { id: 'rug', name: 'Alfombra', width: 2.0, depth: 1.5, height: 0.02, isSurface: false, color: '#c9ada7', price: 89 },
]

export class DefaultCatalog implements FurnitureCatalog {
  items(): readonly CatalogItem[] {
    return ITEMS
  }

  get(id: string): CatalogItem {
    const item = ITEMS.find((i) => i.id === id)
    if (!item) throw new Error(`Artículo desconocido en el catálogo: "${id}"`)
    return item
  }
}
