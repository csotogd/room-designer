import { expect } from 'vitest'
import { scenario } from './gherkin'
import { SceneSync } from '../../src/app/designer/SceneSync'
import { sceneFromState } from '../../src/app/designer/scene'
import type { DesignerRoomState, ManualEdit } from '../../src/app/designer/actions'

scenario('A buffered broadcast cannot undo a later save acknowledgement', async () => {
  const original: DesignerRoomState = { version: 1, revision: 'original',
    room: { shape: 'rect', w: 5, d: 4, h: 2.6 }, items: [], openings: [] }
  let scene = sceneFromState(original)
  let sent!: ManualEdit
  const sync = new SceneSync({ snapshot: () => structuredClone(scene),
    apply: (value) => { scene = structuredClone(value) }, send: (edit) => { sent = edit },
    saved: () => {}, status: () => {} })
  sync.connection(true)
  sync.receive(original)
  scene.environment.timeOfDay = 18
  sync.changed()
  const saved = sync.flush()
  sync.beginGesture()
  sync.receive({ ...original, revision: 'earlier-broadcast' })
  sync.result({ type: 'edit.result', requestId: sent.requestId,
    state: { version: 1, ...sent.desired, revision: 'confirmed' } })
  sync.endGesture()
  await saved
  expect(scene.environment.timeOfDay).toBe(18)
  expect(sync.currentRevision).toBe('confirmed')
})
