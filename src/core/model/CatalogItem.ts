import { Product } from './Product'

/**
 * Alias histórico: el resto del dominio habla de "artículo de catálogo";
 * la entidad real es Product (nombre, descripción, precio y assets).
 */
export type CatalogItem = Product
