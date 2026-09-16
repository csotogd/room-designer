// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { buildZoneOverlay, disposeZoneOverlay } from '../../src/ui/view3d/ZoneOverlay3D'

test('places dashed closed boundaries and name labels on the room floor', () => {
  const context = { clearRect: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), measureText: () => ({ width: 120 }) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  const overlay = buildZoneOverlay([{ id: 'study', name: 'Estudio', x: 1, z: 2, w: 2, d: 3 }])
  const boundary = overlay.getObjectByName('zone-boundary:study') as Line2
  expect(boundary.material).toBeInstanceOf(LineMaterial)
  expect(boundary.material.dashed).toBe(true)
  expect(boundary.material.linewidth).toBeGreaterThanOrEqual(0.03)
  expect(boundary.material.worldUnits).toBe(true)
  expect(boundary.material.transparent).toBe(true)
  expect(boundary.material.toneMapped).toBe(false)
  const starts = boundary.geometry.getAttribute('instanceStart')
  const ends = boundary.geometry.getAttribute('instanceEnd')
  expect(starts.count).toBe(4)
  expect([starts.getX(0), starts.getY(0), starts.getZ(0)]).toEqual([1, expect.closeTo(0.035), 2])
  expect([ends.getX(3), ends.getZ(3)]).toEqual([1, 2])
  const label = overlay.getObjectByName('zone-label:study') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  expect(label.position.toArray()).toEqual([2, 0.045, 3.5])
  expect(label.rotation.x).toBeCloseTo(-Math.PI / 2)
  expect(context.fillText).toHaveBeenCalledWith('Estudio', expect.any(Number), expect.any(Number))
  const lineDispose = vi.spyOn(boundary.geometry, 'dispose')
  const textureDispose = vi.spyOn(label.material.map!, 'dispose')
  disposeZoneOverlay(overlay)
  expect(lineDispose).toHaveBeenCalledOnce()
  expect(textureDispose).toHaveBeenCalledOnce()
  vi.restoreAllMocks()
})
