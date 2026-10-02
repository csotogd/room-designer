// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { beforeEach, expect, vi } from 'vitest'
import { scenario } from './gherkin'
import { CreateRoomModal } from '../../src/ui/panels/CreateRoomModal'
import type { FloorPlan } from '../../src/core/model/FloorPlan'
import { mockCanvas } from '../helpers/canvas'

const el = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const input = (selector: string, value: number) => {
  el<HTMLInputElement>(selector).value = String(value)
  el(selector).dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  mockCanvas()
  Object.defineProperty(SVGSVGElement.prototype, 'createSVGPoint', { configurable: true,
    value: () => ({ x: 0, y: 0, matrixTransform() { return this } }) })
  Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', { configurable: true,
    value: () => ({ inverse: () => ({}) }) })
})

function wizardWithDoor() {
  const created = vi.fn<(plan: FloorPlan) => void>()
  const modal = new CreateRoomModal(document, created)
  modal.show()
  el('#wizard-next').click()
  el('.wizard-wall').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 2, clientY: 0 }))
  return { created, modal }
}

scenario('Preview a room size and shape before continuing', () => {
  new CreateRoomModal(document, vi.fn()).show()
  el('[data-size="large"]').click()
  el('[data-shape="u"]').click()
  input('#dim-cw', 2)
  input('#dim-cd', 2)
  expect(el<HTMLInputElement>('#dim-w').value).toBe('8')
  expect(el<HTMLInputElement>('#dim-d').value).toBe('6')
  expect(document.querySelector('#creation-canvas')).not.toBeNull()
  expect(el('#room-area').textContent).toContain('44')
  expect(el('#wizard-next').hasAttribute('disabled')).toBe(false)
  input('#dim-cw', 9)
  expect(el('#wizard-next').hasAttribute('disabled')).toBe(true)
  expect(el('#room-error').textContent).toMatch(/recorte/i)
})

scenario('Keep openings when returning to unchanged room dimensions', () => {
  const { created } = wizardWithDoor()
  expect(document.querySelectorAll('.wizard-opening')).toHaveLength(1)
  el('#wizard-back').click()
  el('#wizard-next').click()
  el('#create-room').click()
  expect(created.mock.calls[0]![0].openings()).toHaveLength(1)
})

scenario('Resize a selected wizard opening without deleting it', () => {
  const { created } = wizardWithDoor()
  el('.wizard-opening').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  input('#wizard-opening-editor input[type="range"]', 1.8)
  el('#wizard-opening-editor input[type="range"]').dispatchEvent(new Event('change'))
  expect(document.querySelectorAll('.wizard-opening')).toHaveLength(1)
  expect(el<HTMLInputElement>('#wizard-opening-editor input[type="number"]').value).toBe('1.8')
  expect(document.querySelector('.opening-resize-handle')).not.toBeNull()
  el('#create-room').click()
  expect(created.mock.calls[0]![0].openings()[0]!.width).toBe(1.8)
})
