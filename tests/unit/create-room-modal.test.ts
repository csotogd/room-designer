// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import { CreateRoomModal } from '../../src/ui/panels/CreateRoomModal'
import { mockCanvas } from '../helpers/canvas'

test('choosing a beveled room reveals the corner dimensions', () => {
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  mockCanvas()
  new CreateRoomModal(document, vi.fn()).show()
  document.querySelector<HTMLButtonElement>('[data-shape="bevel"]')!.click()
  expect(document.querySelector<HTMLElement>('.cut-only')!.hidden).toBe(false)
  expect(document.querySelector('#creation-canvas')).not.toBeNull()
})
