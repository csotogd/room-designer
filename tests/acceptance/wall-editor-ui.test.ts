// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, vi } from 'vitest'
import { scenario } from './gherkin'
import { App } from '../../src/ui/App'
import { Point2D } from '../../src/core/geometry/Point2D'
import type { Tool2D } from '../../src/ui/types'
import type { ProjectDoc } from '../../src/app/serialization/ProjectSerializer'

const view = vi.hoisted(() => ({ tool: null as Tool2D | null, frame: vi.fn() }))
vi.mock('../../src/ui/view3d/View3D', () => ({ View3D: class { resize() {} setPlacement() {} clearSelection() {} setProject() {} setZones() {} } }))
vi.mock('../../src/ui/view2d/View2D', () => ({ View2D: class {
  setTool(tool: Tool2D) { view.tool = tool }
  setSelectionProvider() {}
  resize() {}
  draw() {}
  setProject() {}
  frameRoom = view.frame
  pixelsToMeters() { return 0.2 }
  cancelTool() { view.tool?.cancel() }
} }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class { connected = false } }))
afterEach(() => vi.unstubAllGlobals())

scenario('Shape a new room in the top-down creation step', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }))
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  const app = new App(document, { items: () => [], get: () => { throw new Error('Sin productos') } })
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
  expect(el('#modal-backdrop').hidden).toBe(false)
  expect(document.querySelector('#edit-room')).toBeNull()
  expect(view.frame).toHaveBeenCalledOnce()
  const pointer = {} as PointerEvent
  view.tool!.onDown(new Point2D(4.5, 2), pointer)
  view.tool!.onMove(new Point2D(6, 2), pointer)
  view.tool!.onUp(new Point2D(6, 2), pointer)
  expect(el('#wall-inspector').hidden).toBe(false)
  expect(el('#wall-inspector').compareDocumentPosition(el('#shape-cards')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(el<HTMLInputElement>('#wall-length').value).toBe('3.5')
  view.tool!.onDown(new Point2D(6, 3.5), pointer)
  view.tool!.onMove(new Point2D(6, 5), pointer)
  view.tool!.onUp(new Point2D(6, 5), pointer)
  expect(el<HTMLInputElement>('#wall-length').value).toBe('5')
  expect(el<HTMLButtonElement>('#draft-undo').disabled).toBe(false)
  el<HTMLInputElement>('#wall-length').value = '6'
  el('#wall-length').dispatchEvent(new Event('change'))
  expect(el<HTMLInputElement>('#wall-length').value).toBe('6')
  el('#wizard-next').click()
  el('#create-room').click()
  expect(el('#modal-backdrop').hidden).toBe(true)
  const wall = (app.debugState() as ProjectDoc).walls[1]!
  expect(wall.end.y - wall.start.y).toBe(6)
})
