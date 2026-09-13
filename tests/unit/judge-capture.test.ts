import * as THREE from 'three'
import { afterEach, expect, test, vi } from 'vitest'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import { modelFor, waitForModels } from '../../src/ui/view3d/models'

const mock = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { load = mock.load } }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

function product(id: string) {
  const item = new DefaultCatalog().items()[0]!
  return { ...item, id, assets: { ...item.assets, modelUrl: `/${id}.glb` } }
}

test('a judge capture waits for actual GLBs instead of an arbitrary delay', async () => {
  const item = product('loaded')
  const rebuilt = vi.fn()
  expect(modelFor(item, rebuilt)).toBeNull()
  let ready = false
  const waiting = waitForModels([item]).then(() => { ready = true })
  await Promise.resolve()
  expect(ready).toBe(false)
  const scene = new THREE.Group()
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
  mock.load.mock.calls[0]![1]({ scene })
  await waiting
  expect(ready).toBe(true)
  expect(rebuilt).toHaveBeenCalledOnce()
  expect(modelFor(item, rebuilt)).toBeInstanceOf(THREE.Group)
})

test('failed assets and loading timeouts are reported instead of judging placeholders', async () => {
  const failed = product('failed')
  modelFor(failed, () => {})
  mock.load.mock.calls[0]![3]()
  await expect(waitForModels([failed])).rejects.toThrow('No se pudieron cargar')
  vi.useFakeTimers()
  const pending = product('pending')
  modelFor(pending, () => {})
  const timedOut = expect(waitForModels([pending], 100)).rejects.toThrow('no terminaron de cargar')
  await vi.advanceTimersByTimeAsync(101)
  await timedOut
})
