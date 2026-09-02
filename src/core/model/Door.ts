import { Opening, type OpeningKind } from './Opening'

export class Door extends Opening {
  constructor(offset: number, width: number, height = 2.0, id?: string) {
    super(offset, width, height, 0, id)
  }

  get kind(): OpeningKind {
    return 'door'
  }
}
