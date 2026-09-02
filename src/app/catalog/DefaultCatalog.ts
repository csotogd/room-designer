import { Product } from '../../core/model/Product'
import type { CatalogItem } from '../../core/model/CatalogItem'
import type { FurnitureCatalog } from './FurnitureCatalog'

/**
 * Catálogo local por defecto. En producción, GrpcCatalog sirve estos mismos
 * Product desde el backend, con imageUrl/modelUrl apuntando al bucket.
 */
const PRODUCTS: readonly Product[] = [
  new Product({ id: 'sofa', name: 'Sofá 3 plazas', description: 'Sofá tapizado en tejido verde salvia con cojines sueltos.', width: 2.0, depth: 0.9, height: 0.8, price: 499, isSurface: false, color: '#7c9885' }),
  new Product({ id: 'armchair', name: 'Sillón', description: 'Sillón compacto a juego con el sofá, ideal para rincones de lectura.', width: 0.95, depth: 0.85, height: 0.8, price: 299, isSurface: false, color: '#8fa898', form: 'sofa' }),
  new Product({ id: 'chair', name: 'Silla', description: 'Silla de madera maciza con respaldo alto.', width: 0.5, depth: 0.52, height: 0.9, price: 49, isSurface: false, color: '#9c6644' }),
  new Product({ id: 'stool', name: 'Taburete', description: 'Taburete bajo apilable, útil como asiento extra.', width: 0.42, depth: 0.42, height: 0.45, price: 29, isSurface: false, color: '#a9835c', form: 'stool' }),
  new Product({ id: 'bench', name: 'Banco', description: 'Banco de recibidor en roble, aguanta lo que le eches.', width: 1.2, depth: 0.38, height: 0.45, price: 119, isSurface: true, color: '#b08968', form: 'bench' }),
  new Product({ id: 'pouf', name: 'Puf', description: 'Puf redondo tapizado, reposapiés o asiento informal.', width: 0.55, depth: 0.55, height: 0.38, price: 59, isSurface: false, color: '#c58c66', form: 'pouf' }),
  new Product({ id: 'table', name: 'Mesa de comedor', description: 'Mesa de comedor de madera para cuatro personas.', width: 1.4, depth: 0.8, height: 0.75, price: 199, isSurface: true, color: '#b08968' }),
  new Product({ id: 'desk', name: 'Escritorio', description: 'Escritorio sobrio con tablero amplio para teletrabajar.', width: 1.2, depth: 0.6, height: 0.74, price: 229, isSurface: true, color: '#8d6b4b', form: 'table' }),
  new Product({ id: 'coffee-table', name: 'Mesa de centro', description: 'Mesa de centro baja para el sofá.', width: 0.9, depth: 0.55, height: 0.42, price: 129, isSurface: true, color: '#bfa07e', form: 'table' }),
  new Product({ id: 'nightstand', name: 'Mesita de noche', description: 'Mesita de noche con hueco para tus libros de antes de dormir.', width: 0.45, depth: 0.4, height: 0.55, price: 79, isSurface: true, color: '#a3785a', form: 'sideboard' }),
  new Product({ id: 'dresser', name: 'Cómoda', description: 'Cómoda de cuatro cajones con tiradores metálicos.', width: 0.9, depth: 0.45, height: 1.1, price: 279, isSurface: true, color: '#8a6a4f', form: 'sideboard' }),
  new Product({ id: 'sideboard', name: 'Aparador', description: 'Aparador bajo con puertas correderas para el salón.', width: 1.6, depth: 0.45, height: 0.85, price: 249, isSurface: true, color: '#936639' }),
  new Product({ id: 'wardrobe', name: 'Armario', description: 'Armario de dos puertas con barra y estantes interiores.', width: 1.2, depth: 0.6, height: 2.0, price: 299, isSurface: true, color: '#6b705c' }),
  new Product({ id: 'shelf', name: 'Estantería', description: 'Estantería abierta de cinco baldas.', width: 0.8, depth: 0.4, height: 1.8, price: 129, isSurface: true, color: '#a68a64' }),
  new Product({ id: 'bookcase', name: 'Librería', description: 'Librería ancha para colecciones serias.', width: 1.2, depth: 0.35, height: 2.0, price: 189, isSurface: true, color: '#7f5f43', form: 'shelf' }),
  new Product({ id: 'bed', name: 'Cama 160', description: 'Cama doble con cabecero, colchón y edredón incluidos en la escena.', width: 1.6, depth: 2.0, height: 0.55, price: 399, isSurface: true, color: '#8e9aaf' }),
  new Product({ id: 'mirror', name: 'Espejo de pie', description: 'Espejo de cuerpo entero con marco fino.', width: 0.5, depth: 0.06, height: 1.7, price: 99, isSurface: false, color: '#d8d8d8', form: 'mirror' }),
  new Product({ id: 'rug', name: 'Alfombra', description: 'Alfombra de pelo corto en tono tierra.', width: 2.0, depth: 1.5, height: 0.02, price: 89, isSurface: false, color: '#c9ada7' }),
  new Product({ id: 'plant', name: 'Planta', description: 'Planta de interior de bajo mantenimiento (casi imposible de matar).', width: 0.4, depth: 0.4, height: 1.2, price: 25, isSurface: false, color: '#52796f' }),
  new Product({ id: 'vase', name: 'Jarrón', description: 'Jarrón de cerámica azul, perfecto sobre una mesa o aparador.', width: 0.2, depth: 0.2, height: 0.35, price: 12, isSurface: false, color: '#4a7ba6' }),
  new Product({ id: 'tv', name: 'Televisor 55"', description: 'Televisor plano sobre peana, para colocar sobre un mueble bajo.', width: 1.2, depth: 0.08, height: 0.7, price: 599, isSurface: false, color: '#22223b' }),
]

export class DefaultCatalog implements FurnitureCatalog {
  items(): readonly CatalogItem[] {
    return PRODUCTS
  }

  get(id: string): CatalogItem {
    const product = PRODUCTS.find((p) => p.id === id)
    if (!product) throw new Error(`Artículo desconocido en el catálogo: "${id}"`)
    return product
  }
}
