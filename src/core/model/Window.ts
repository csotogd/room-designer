import { Opening, type OpeningKind } from './Opening'

export class Window extends Opening {
  constructor(offset: number, width: number, height = 1.1, sillHeight = 0.9, id?: string) {
    super(offset, width, height, sillHeight, id)
  }

  get kind(): OpeningKind {
    return 'window'
  }
}
