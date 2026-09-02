import { newId } from '../util/id'

export type OpeningKind = 'door' | 'window'

/**
 * Apertura en una pared (puerta o ventana). No tiene coordenadas absolutas:
 * vive paramétricamente en su pared — offset desde el inicio, ancho, alto y
 * altura de antepecho. Si la pared se mueve, la apertura viaja con ella.
 */
export abstract class Opening {
  readonly id: string

  constructor(
    public offset: number,
    readonly width: number,
    readonly height: number,
    readonly sillHeight: number,
    id?: string,
  ) {
    this.id = id ?? newId('opening')
  }

  abstract get kind(): OpeningKind

  get end(): number {
    return this.offset + this.width
  }

  overlaps(other: Opening): boolean {
    return this.offset < other.end && other.offset < this.end
  }
}
