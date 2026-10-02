// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { View2D } from '../../src/ui/view2d/View2D'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Point2D } from '../../src/core/geometry/Point2D'

test('frame the entire room and cancel a pointer gesture on capture loss', () => {
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  const context = Object.fromEntries(['clearRect', 'setTransform', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'closePath', 'fill'].map(name => [name, vi.fn()]))
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  const project = new Project(FloorPlan.rectangle(30, 20))
  const view = new View2D(canvas, project)
  view.resize()
  view.frameRoom()
  for (const point of [new Point2D(0, 0), new Point2D(30, 20)]) {
    const [x, y] = view.toScreen(point)
    expect(x).toBeGreaterThan(30)
    expect(x).toBeLessThan(770)
    expect(y).toBeGreaterThan(30)
    expect(y).toBeLessThan(570)
    expect(view.toWorld(x, y).equals(point)).toBe(true)
  }
  expect(view.pixelsToMeters(10)).toBeGreaterThan(0)
  const cancel = vi.fn()
  view.setTool({ onDown() {}, onMove() {}, onUp() {}, drawOverlay() {}, cancel })
  canvas.dispatchEvent(new Event('pointercancel'))
  expect(cancel).toHaveBeenCalledOnce()
})
