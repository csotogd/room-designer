// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { ZonePlanPanel } from '../../src/ui/panels/ZonePlanPanel'

test('reports automatic zone work without furniture buttons or an extra map', () => {
  const container = document.createElement('div')
  const panel = new ZonePlanPanel(container)
  panel.render({ version: 1, room: { shape: 'rect', w: 6, d: 4, h: 2.6 }, items: [], openings: [],
    zones: [{ id: 'a', name: '<img src=x>', x: 1, z: 0, w: 2, d: 3 }],
    zoneResults: { a: { status: 'furnishing', reply: 'Amueblando…' } } })
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('button')).toBeNull()
  expect(container.querySelector('svg')).toBeNull()
  expect(container.textContent).toContain('Amueblando')
  expect(container.textContent).toContain('<img src=x>')
  panel.render({ version: 1, room: null, items: [], openings: [] })
  expect(container.hidden).toBe(true)
  expect(container.children).toHaveLength(0)
})
