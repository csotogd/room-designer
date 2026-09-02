import { Point2D } from '../geometry/Point2D'
import { Segment } from '../geometry/Segment'
import { newId } from '../util/id'
import type { Opening } from './Opening'

/** Pared: segmento 2D con grosor y altura, dueña de sus aperturas. */
export class Wall {
  readonly id: string
  private _start: Point2D
  private _end: Point2D
  private readonly _openings: Opening[] = []

  constructor(
    start: Point2D,
    end: Point2D,
    public thickness = 0.12,
    public height = 2.5,
    id?: string,
  ) {
    this._start = start
    this._end = end
    this.id = id ?? newId('wall')
  }

  get start(): Point2D {
    return this._start
  }

  get end(): Point2D {
    return this._end
  }

  get openings(): readonly Opening[] {
    return this._openings
  }

  segment(): Segment {
    return new Segment(this._start, this._end)
  }

  length(): number {
    return this._start.distanceTo(this._end)
  }

  direction(): Point2D {
    return this._end.sub(this._start).normalized()
  }

  addOpening(opening: Opening): void {
    this.assertFits(opening)
    const overlapping = this._openings.find((o) => o.overlaps(opening))
    if (overlapping) throw new Error('La apertura se solapa con otra existente')
    this._openings.push(opening)
  }

  /** ¿Cabría la apertura en `offset` sin salirse ni chocar con las demás? */
  canPlaceOpening(opening: Opening, offset: number): boolean {
    if (offset < 0 || offset + opening.width > this.length()) return false
    const candidate = { offset, end: offset + opening.width }
    return this._openings.every(
      (o) => o === opening || o.end <= candidate.offset || o.offset >= candidate.end,
    )
  }

  /** Desliza una apertura existente a un nuevo offset validado. */
  moveOpening(opening: Opening, offset: number): void {
    if (!this._openings.includes(opening)) {
      throw new Error('La apertura no pertenece a esta pared')
    }
    if (!this.canPlaceOpening(opening, offset)) {
      throw new Error('La apertura no cabe en esa posición de la pared')
    }
    opening.offset = offset
  }

  removeOpening(opening: Opening): void {
    const index = this._openings.indexOf(opening)
    if (index >= 0) this._openings.splice(index, 1)
  }

  /** Centro de la apertura en coordenadas de plano. */
  worldCenterOf(opening: Opening): Point2D {
    return this.segment().pointAtDistance(opening.offset + opening.width / 2)
  }

  moveTo(start: Point2D, end: Point2D): void {
    const previous = [this._start, this._end] as const
    this._start = start
    this._end = end
    for (const opening of this._openings) {
      if (opening.end > this.length()) {
        ;[this._start, this._end] = previous
        throw new Error('La pared no puede encoger: sus aperturas no caben dentro')
      }
    }
  }

  private assertFits(opening: Opening): void {
    if (opening.offset < 0 || opening.end > this.length()) {
      throw new Error('La apertura debe quedar dentro de los límites de la pared')
    }
  }
}
