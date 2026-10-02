// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { App } from '../../src/ui/App'
import { Door } from '../../src/core/model/Door'
import type { Project } from '../../src/core/model/Project'
import type { Selectable } from '../../src/ui/view3d/View3D'
import { mockCanvas } from '../helpers/canvas'

const scene = vi.hoisted(() => ({ project: null as Project | null,
  select: null as ((selection: Selectable | null) => void) | null }))
vi.mock('../../src/ui/view3d/View3D', () => ({ View3D: class {
  constructor(_container: HTMLElement, project: Project, deps: { onSelectionChange: typeof scene.select }) {
    scene.project = project
    scene.select = deps.onSelectionChange
  }
  resize() {}
  setPlacement() {}
  clearSelection() {}
  setZones() {}
} }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class { connected = false } }))
afterEach(() => vi.unstubAllGlobals())

test('selecting a scene door exposes live width and working undo controls', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }))
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  mockCanvas()
  new App(document, { items: () => [], get: () => { throw new Error('Sin productos') } })
  const wall = scene.project!.floorPlan.walls[0]!
  const opening = new Door(1, 0.9)
  scene.project!.addOpening(wall, opening)
  scene.select!({ type: 'opening', wall, opening })
  const slider = document.querySelector<HTMLInputElement>('#inspector input[type="range"]')!
  slider.value = '1.6'
  slider.dispatchEvent(new Event('input'))
  expect(opening.width).toBe(1.6)
  slider.dispatchEvent(new Event('change'))
  const undo = document.querySelector<HTMLButtonElement>('#undo')!
  expect(undo.disabled).toBe(false)
  undo.click()
  expect(opening.width).toBe(0.9)
  expect(slider.value).toBe('0.9')
  const redo = document.querySelector<HTMLButtonElement>('#redo')!
  expect(redo.disabled).toBe(false)
  redo.click()
  expect(opening.width).toBe(1.6)
  expect(undo.disabled).toBe(false)
  expect(redo.disabled).toBe(true)
})
