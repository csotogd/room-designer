/** Acabados de superficie elegibles por el usuario. */

export type WallMaterial = 'paint' | 'stripes' | 'brick'
export type FloorMaterial = 'wood' | 'tiles' | 'carpet' | 'concrete'

export interface WallFinish {
  readonly material: WallMaterial
  readonly color: string
}

export interface FloorFinish {
  readonly material: FloorMaterial
  readonly color: string
}

export const DEFAULT_WALL_FINISH: WallFinish = { material: 'paint', color: '#f2eee4' }
export const DEFAULT_FLOOR_FINISH: FloorFinish = { material: 'wood', color: '#d9c5a3' }
