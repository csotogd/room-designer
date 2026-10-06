// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { CreateRoomModal } from '../../src/ui/panels/CreateRoomModal'
import { mockCanvas } from '../helpers/canvas'

const parsed = {
  corners: [[0, 0], [6, 0], [6, 4.5], [3.5, 4.5], [3.5, 3], [0, 3]],
  height: 2.5,
  openings: [
    { wall: 5, offset: 1.1, width: 0.9, kind: 'door' },
    { wall: 0, offset: 2.4, width: 1.4, kind: 'window' },
  ],
  scaleEstimated: true,
  confidence: 0.9,
  notes: 'Parser determinista de test, sin VLM.',
  dropped: [],
}

function modalWithFetch(response: Partial<Response>): CreateRoomModal {
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  mockCanvas()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(parsed), ...response }))
  const modal = new CreateRoomModal(document, vi.fn())
  modal.show()
  return modal
}

afterEach(() => vi.unstubAllGlobals())

test('an imported plan lands on the editable draft with its openings', async () => {
  const modal = modalWithFetch({})
  await modal.importPlanFile(new File([new Uint8Array([137, 80])], 'plano.png', { type: 'image/png' }))

  const status = document.querySelector<HTMLElement>('#plan-import-status')!
  expect(status.textContent).toContain('estimadas')
  expect(document.querySelector<HTMLButtonElement>('#wizard-next')!.disabled).toBe(false)

  document.querySelector<HTMLButtonElement>('#wizard-next')!.click()
  expect(document.querySelectorAll('#wizard-plan .wizard-opening')).toHaveLength(2)
})

test('a rejected plan shows the reason and keeps the wizard usable', async () => {
  const modal = modalWithFetch({
    ok: false,
    json: () => Promise.resolve({ error: 'La imagen no contiene un plano reconocible' }),
  })
  await modal.importPlanFile(new File([new Uint8Array([1])], 'gato.png', { type: 'image/png' }))

  expect(document.querySelector('#plan-import-status')!.textContent).toContain('plano reconocible')
  expect(document.querySelector<HTMLButtonElement>('#wizard-next')!.disabled).toBe(false)
})

test('only PNG or JPEG images are offered to the parser', async () => {
  const modal = modalWithFetch({})
  await modal.importPlanFile(new File([new Uint8Array([1])], 'plano.pdf', { type: 'application/pdf' }))
  expect(document.querySelector('#plan-import-status')!.textContent).toContain('PNG o JPG')
  expect(vi.mocked(fetch)).not.toHaveBeenCalled()
})
