import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { DesignerZone } from '../../app/designer/actions'
import { ZONE_COLORS } from '../panels/ZonePlanPanel'

/** Las divisiones son una anotación sobre el suelo, sin paredes ni superficie opaca. */
export function buildZoneOverlay(zones: readonly DesignerZone[]): THREE.Group {
  const group = new THREE.Group()
  for (const [index, zone] of zones.entries()) {
    const color = ZONE_COLORS[index % ZONE_COLORS.length]!
    const points = [[zone.x, zone.z], [zone.x + zone.w, zone.z],
      [zone.x + zone.w, zone.z + zone.d], [zone.x, zone.z + zone.d], [zone.x, zone.z]]
    const geometry = new LineGeometry().setPositions(points.flatMap(([x, z]) => [x!, 0.035, z!]))
    const boundary = new Line2(geometry, new LineMaterial({
      color: new THREE.Color(color).getHex(), dashed: true, linewidth: 0.035, worldUnits: true, dashSize: 0.16, gapSize: 0.1, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
    }))
    boundary.name = `zone-boundary:${zone.id}`
    boundary.computeLineDistances()
    boundary.renderOrder = 30
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 160
    const context = canvas.getContext('2d')!
    context.font = '600 120px sans-serif'
    const width = context.measureText(zone.name).width
    context.font = `600 ${Math.min(120, 120 * 960 / Math.max(width, 1))}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = color
    context.strokeStyle = '#ffffff'
    context.lineWidth = 10
    context.lineJoin = 'round'
    context.strokeText(zone.name, canvas.width / 2, canvas.height / 2)
    context.fillText(zone.name, canvas.width / 2, canvas.height / 2)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const labelWidth = Math.min(3.4, zone.w * 0.9, zone.d * 2)
    const label = new THREE.Mesh(new THREE.PlaneGeometry(labelWidth, labelWidth / 6.4),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }))
    label.name = `zone-label:${zone.id}`
    label.position.set(zone.x + zone.w / 2, 0.045, zone.z + zone.d / 2)
    label.rotation.x = -Math.PI / 2
    label.renderOrder = 31
    group.add(boundary, label)
  }
  return group
}

export function disposeZoneOverlay(group: THREE.Group): void {
  for (const object of group.children) {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose()
      const material = object.material as THREE.MeshBasicMaterial
      material.map?.dispose()
      material.dispose()
    }
  }
  group.clear()
}
