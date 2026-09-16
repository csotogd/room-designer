// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { App } from '../../src/ui/App'
import { FloorPlan } from '../../src/core/model/FloorPlan'

const room = vi.hoisted(() => ({ create: null as ((plan: FloorPlan) => void) | null }))
vi.mock('../../src/ui/view3d/View3D', () => ({ View3D: class {
  resize() {}
  setProject() {}
  setPlacement() {}
  clearSelection() {}
} }))
vi.mock('../../src/ui/panels/ChatPanel', () => ({ ChatPanel: class {
  setOpen() {}
  onSceneChanged() {}
} }))
vi.mock('../../src/ui/panels/CreateRoomModal', () => ({ CreateRoomModal: class {
  constructor(_root: Document, create: (plan: FloorPlan) => void) { room.create = create }
  show() {}
  hide() {}
} }))
afterEach(() => { vi.unstubAllGlobals() })

test('the app starts and replaces its room without time controls', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }))
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  document.querySelector('.time-group')?.remove()

  const app = new App(document, { items: () => [], get: () => { throw new Error('Sin productos') } })
  room.create!(FloorPlan.rectangle(6, 4))

  expect(document.querySelector('#room-meta')!.textContent).toBe('24 m²')
  expect(app.debugState()).toMatchObject({ timeOfDay: 12 })
})
