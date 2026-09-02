import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Point2D } from '../../core/geometry/Point2D'
import { Point3D } from '../../core/geometry/Point3D'
import { Door } from '../../core/model/Door'
import { Window } from '../../core/model/Window'
import { CeilingLight, FloorLamp, WallLight } from '../../core/model/LightPoint'
import type { Furniture } from '../../core/model/Furniture'
import type { LightPoint } from '../../core/model/LightPoint'
import type { Opening } from '../../core/model/Opening'
import type { Project } from '../../core/model/Project'
import type { Wall } from '../../core/model/Wall'
import type { CatalogItem } from '../../core/model/CatalogItem'
import type { CommandStack } from '../../app/commands/CommandStack'
import { MoveFurnitureCommand } from '../../app/commands/FurnitureCommands'
import { PlaceFurnitureCommand } from '../../app/commands/PlaceFurnitureCommand'
import { AddOpeningCommand, MoveOpeningCommand } from '../../app/commands/PlanCommands'
import { AddLightCommand, MoveLightCommand } from '../../app/commands/LightCommands'
import { dropFurniture, surfaceAt } from '../../app/editor/FurnitureDrop'
import { fitsInRoom } from '../../app/editor/RoomBounds'
import { slideOffset } from '../../app/editor/OpeningDrag'
import {
  buildFloor,
  buildFurniture,
  buildGhost,
  buildLight,
  buildWall,
  pickOf,
  tintGroup,
  type Pick,
} from './builders'

const DAY_SKY = new THREE.Color(0xe8f0f6)
const NIGHT_SKY = new THREE.Color(0x151d2b)
const SUN_WARM = new THREE.Color(0xffd9a0)
const SUN_WHITE = new THREE.Color(0xffffff)
const HOVER_TINT = 0x224466
const SELECT_TINT = 0x0058a3
const INVALID_TINT = 0xc0392b

export type Placement =
  | { type: 'furniture'; item: CatalogItem }
  | { type: 'opening'; kind: 'door' | 'window' }
  | { type: 'light'; kind: 'ceiling' | 'wall' | 'floor' }

export type Selectable = Extract<Pick, { type: 'furniture' | 'opening' | 'light' }>

interface DragState {
  pick: Selectable
  moved: boolean
  startFurniture?: { x: number; z: number }
  startOffset?: number
  startLightPos?: Point3D
  grab?: { dx: number; dz: number }
}

interface View3DDeps {
  stack: CommandStack
  onSelectionChange: (selection: Selectable | null) => void
  onPlacementDone: () => void
  onHint: (message: string) => void
}

/**
 * Editor 3D interactivo: todo se selecciona y arrastra dentro de la escena.
 * Muebles sobre el suelo o superficies, aperturas deslizando por su pared,
 * luces en su plano. Soltar/clic fuera fija el objeto.
 */
export class View3D {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly sun: THREE.DirectionalLight
  private readonly hemisphere: THREE.HemisphereLight
  private readonly raycaster = new THREE.Raycaster()
  private roomGroup = new THREE.Group()
  private ghostGroup = new THREE.Group()
  private dirty = true
  private unsubscribe: (() => void) | null = null

  private furnitureGroups = new Map<Furniture, THREE.Group>()
  private openingGroups = new Map<Opening, THREE.Group>()
  private lightGroups = new Map<LightPoint, THREE.Group>()
  private wallGroups = new Map<Wall, THREE.Group>()

  private readonly fadedWalls = new Set<Wall>()
  private selection: Selectable | null = null
  private hovered: Selectable | null = null
  private drag: DragState | null = null
  private dragInvalid = false
  private placement: Placement | null = null
  private placementValid = false
  private placementPoint: THREE.Vector3 | null = null
  private placementWallHit: { wall: Wall; offset: number } | null = null
  private downAt: [number, number] | null = null

  constructor(
    private readonly container: HTMLElement,
    private project: Project,
    private readonly deps: View3DDeps,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03
    this.controls.minDistance = 1.5
    this.controls.maxDistance = 40

    this.hemisphere = new THREE.HemisphereLight(0xbfd7ea, 0x8a7f70, 0.5)
    this.scene.add(this.hemisphere)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22))

    this.sun = new THREE.DirectionalLight(SUN_WHITE, 3)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 70 })
    this.sun.shadow.bias = -0.0004
    this.scene.add(this.sun, this.sun.target)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(70, 48),
      new THREE.MeshStandardMaterial({ color: 0xcfd5c9, roughness: 1, side: THREE.DoubleSide }),
    )
    ground.geometry.rotateX(Math.PI / 2)
    ground.position.y = -0.012
    ground.receiveShadow = true
    this.scene.add(ground)

    this.scene.add(this.roomGroup, this.ghostGroup)
    this.subscribe()
    this.frameRoom()
    this.bindPointer()
    this.renderer.setAnimationLoop(() => this.tick())
  }

  // ── API pública ──────────────────────────────────────────────────────────

  setProject(project: Project): void {
    this.unsubscribe?.()
    this.project = project
    this.subscribe()
    this.select(null)
    this.dirty = true
    this.frameRoom()
  }

  setPlacement(placement: Placement | null): void {
    this.placement = placement
    this.ghostGroup.clear()
    this.placementPoint = null
    this.placementWallHit = null
    if (placement) this.select(null)
  }

  getSelection(): Selectable | null {
    return this.selection
  }

  resize(): void {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return
    this.renderer.setSize(clientWidth, clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
  }

  frameRoom(): void {
    const center = this.roomCenter()
    const radius = this.roomRadius()
    this.controls.target.set(center.x, 0.7, center.z)
    this.camera.position.set(center.x + radius * 1.35, radius * 1.15, center.z + radius * 1.7)
    this.controls.update()
  }

  // ── Bucle ────────────────────────────────────────────────────────────────

  private subscribe(): void {
    this.unsubscribe = this.project.events.on('changed', () => {
      this.dirty = true
    })
  }

  private tick(): void {
    this.flushIfDirty()
    this.fadeWallsTowardCamera()
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  /**
   * El picking debe ver SIEMPRE la escena al día: si el dominio cambió desde
   * el último frame, reconstruimos antes de lanzar el rayo (no esperamos al
   * siguiente animation frame).
   */
  private flushIfDirty(): void {
    if (this.dirty) {
      this.rebuild()
      this.dirty = false
    }
  }

  private rebuild(): void {
    this.scene.remove(this.roomGroup)
    disposeGroup(this.roomGroup)
    this.roomGroup = new THREE.Group()
    this.furnitureGroups.clear()
    this.openingGroups.clear()
    this.lightGroups.clear()
    this.wallGroups.clear()

    for (const wall of this.project.floorPlan.walls) {
      const group = buildWall(wall)
      this.wallGroups.set(wall, group)
      for (const opening of wall.openings) {
        const fixture = group.children.find(
          (c) => (c.userData.pick as Pick | undefined)?.type === 'opening' &&
            (c.userData.pick as { opening: Opening }).opening === opening,
        )
        if (fixture instanceof THREE.Group) this.openingGroups.set(opening, fixture)
      }
      this.roomGroup.add(group)
    }
    const polygon = this.project.floorPlan.floorPolygon()
    if (polygon) this.roomGroup.add(buildFloor(polygon))
    for (const furniture of this.project.furniture) {
      const group = buildFurniture(furniture)
      this.furnitureGroups.set(furniture, group)
      this.roomGroup.add(group)
    }
    for (const light of this.project.lights) {
      const group = buildLight(light)
      this.lightGroups.set(light, group)
      this.roomGroup.add(group)
    }
    this.scene.add(this.roomGroup)
    this.updateSun()
    this.applyHighlights()
  }

  private applyHighlights(): void {
    if (this.hovered && !this.drag) {
      const group = this.groupFor(this.hovered)
      if (group) tintGroup(group, HOVER_TINT, 0.25)
    }
    if (this.selection) {
      const group = this.groupFor(this.selection)
      if (group) tintGroup(group, this.dragInvalid ? INVALID_TINT : SELECT_TINT, 0.35)
    }
  }

  private groupFor(pick: Selectable): THREE.Group | undefined {
    switch (pick.type) {
      case 'furniture':
        return this.furnitureGroups.get(pick.furniture)
      case 'opening':
        return this.openingGroups.get(pick.opening)
      case 'light':
        return this.lightGroups.get(pick.light)
    }
  }

  /** Paredes entre la cámara y la habitación se vuelven translúcidas. */
  private fadeWallsTowardCamera(): void {
    const center = this.roomCenter()
    for (const [wall, group] of this.wallGroups) {
      const material = group.userData.wallMaterial as THREE.MeshStandardMaterial
      const mid = new THREE.Vector3(
        (wall.start.x + wall.end.x) / 2,
        wall.height / 2,
        (wall.start.y + wall.end.y) / 2,
      )
      const direction = wall.direction()
      const outward = new THREE.Vector3(-direction.y, 0, direction.x)
      if (outward.dot(new THREE.Vector3(mid.x - center.x, 0, mid.z - center.z)) < 0) {
        outward.negate()
      }
      const toCamera = new THREE.Vector3().subVectors(this.camera.position, mid).setY(0).normalize()
      const facing = outward.dot(toCamera)
      const faded = facing > 0.25
      material.opacity = faded ? 0.13 : 1
      material.depthWrite = !faded
      if (faded) this.fadedWalls.add(wall)
      else this.fadedWalls.delete(wall)
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material === material) obj.castShadow = !faded
      })
    }
  }

  // ── Sol y ambiente ───────────────────────────────────────────────────────

  private updateSun(): void {
    const altitude = this.project.sunAltitude()
    const azimuth = this.project.sunAzimuth()
    const daylight = Math.sin(Math.min(altitude * 2, Math.PI / 2))
    const center = this.roomCenter()

    this.sun.intensity = 3.2 * Math.max(daylight, 0)
    this.sun.color.copy(SUN_WARM).lerp(SUN_WHITE, Math.min(daylight * 1.4, 1))
    const distance = 25
    this.sun.position.set(
      center.x + Math.cos(altitude) * Math.sin(azimuth) * distance,
      Math.max(Math.sin(altitude) * distance, 0.5),
      center.z + Math.cos(altitude) * Math.cos(azimuth) * distance,
    )
    this.sun.target.position.set(center.x, 0, center.z)
    this.hemisphere.intensity = 0.18 + 0.45 * daylight
    this.scene.background = NIGHT_SKY.clone().lerp(DAY_SKY, daylight)
  }

  // ── Puntero ──────────────────────────────────────────────────────────────

  private bindPointer(): void {
    const dom = this.renderer.domElement
    dom.addEventListener('pointerdown', (e) => this.onDown(e))
    dom.addEventListener('pointermove', (e) => this.onMove(e))
    dom.addEventListener('pointerup', (e) => this.onUp(e))
  }

  private onDown(event: PointerEvent): void {
    if (event.button !== 0) return
    this.downAt = [event.clientX, event.clientY]
    if (this.placement) return

    const pick = this.pickAt(event)
    if (pick && (pick.type === 'furniture' || pick.type === 'opening' || pick.type === 'light')) {
      this.controls.enabled = false
      this.beginDrag(pick, event)
    }
  }

  private onMove(event: PointerEvent): void {
    if (this.placement) {
      this.updatePlacementGhost(event)
      return
    }
    if (this.drag) {
      this.updateDrag(event)
      return
    }
    const pick = this.pickAt(event)
    const selectable =
      pick && (pick.type === 'furniture' || pick.type === 'opening' || pick.type === 'light')
        ? pick
        : null
    if (!sameSelectable(selectable, this.hovered)) {
      if (this.hovered) {
        const group = this.groupFor(this.hovered)
        if (group) tintGroup(group, 0x000000, 0)
      }
      this.hovered = selectable
      this.applyHighlights()
    }
    this.renderer.domElement.style.cursor = selectable ? 'pointer' : 'default'
  }

  private onUp(event: PointerEvent): void {
    const wasClick =
      this.downAt !== null &&
      Math.hypot(event.clientX - this.downAt[0], event.clientY - this.downAt[1]) < 6
    this.downAt = null

    if (this.placement) {
      if (wasClick) this.commitPlacement()
      return
    }

    if (this.drag) {
      const drag = this.drag
      this.drag = null
      this.controls.enabled = true
      if (drag.moved) this.commitDrag(drag)
      else this.select(drag.pick)
      this.dragInvalid = false
      this.dirty = true
      return
    }

    if (wasClick) {
      const pick = this.pickAt(event)
      if (!pick || pick.type === 'floor' || pick.type === 'wall') this.select(null)
    }
  }

  // ── Selección ────────────────────────────────────────────────────────────

  private select(selection: Selectable | null): void {
    this.selection = selection
    this.dirty = true
    this.deps.onSelectionChange(selection)
  }

  // ── Arrastre ─────────────────────────────────────────────────────────────

  private beginDrag(pick: Selectable, event: PointerEvent): void {
    const drag: DragState = { pick, moved: false }
    if (pick.type === 'furniture') {
      const hit = this.intersectFloorPlane(event, 0)
      const f = pick.furniture
      drag.startFurniture = { x: f.position.x, z: f.position.z }
      drag.grab = hit
        ? { dx: hit.x - f.position.x, dz: hit.z - f.position.z }
        : { dx: 0, dz: 0 }
    } else if (pick.type === 'opening') {
      drag.startOffset = pick.opening.offset
    } else {
      drag.startLightPos = pick.light.position
    }
    this.drag = drag
    this.select(pick)
  }

  private updateDrag(event: PointerEvent): void {
    const drag = this.drag!
    drag.moved = true
    const pick = drag.pick

    if (pick.type === 'furniture') {
      const hit = this.intersectFloorPlane(event, 0)
      if (!hit) return
      const targetX = hit.x - drag.grab!.dx
      const targetZ = hit.z - drag.grab!.dz
      const f = pick.furniture
      if (fitsInRoom(this.project.floorPlan, f.item, targetX, targetZ, f.rotationY)) {
        this.dragInvalid = false
        this.project.moveFurniture(f, targetX, targetZ)
      } else {
        this.dragInvalid = true
        this.dirty = true
      }
    } else if (pick.type === 'opening') {
      const point = this.intersectWallPlane(event, pick.wall)
      if (!point) return
      const offset = slideOffset(pick.wall, pick.opening, point)
      if (pick.wall.canPlaceOpening(pick.opening, offset)) {
        this.dragInvalid = false
        this.project.moveOpening(pick.wall, pick.opening, offset)
      } else {
        this.dragInvalid = true
        this.dirty = true
      }
    } else {
      const light = pick.light
      if (light.kind === 'wall') {
        const hit = this.intersectFloorPlane(event, 0)
        if (!hit) return
        const wall = this.project.floorPlan.wallAt(new Point2D(hit.x, hit.z), 1.2)
        if (!wall) return
        const along = wall.segment().projectDistance(new Point2D(hit.x, hit.z))
        const anchor = wall.segment().pointAtDistance(along)
        this.project.moveLight(light, new Point3D(anchor.x, light.position.y, anchor.y))
      } else {
        const planeY = light.kind === 'ceiling' ? light.position.y : 0
        const hit = this.intersectFloorPlane(event, planeY)
        if (!hit) return
        this.project.moveLight(light, new Point3D(hit.x, light.position.y, hit.z))
      }
    }
  }

  private commitDrag(drag: DragState): void {
    const pick = drag.pick
    if (pick.type === 'furniture') {
      const f = pick.furniture
      const final = { x: f.position.x, z: f.position.z }
      this.project.moveFurniture(f, drag.startFurniture!.x, drag.startFurniture!.z)
      this.deps.stack.execute(new MoveFurnitureCommand(this.project, f, final.x, final.z))
      dropFurniture(this.project, f, final.x, final.z)
    } else if (pick.type === 'opening') {
      const finalOffset = pick.opening.offset
      if (finalOffset !== drag.startOffset) {
        this.project.moveOpening(pick.wall, pick.opening, drag.startOffset!)
        this.deps.stack.execute(
          new MoveOpeningCommand(this.project, pick.wall, pick.opening, finalOffset),
        )
      }
    } else {
      const final = pick.light.position
      this.project.moveLight(pick.light, drag.startLightPos!)
      this.deps.stack.execute(new MoveLightCommand(this.project, pick.light, final))
    }
  }

  // ── Colocación (modo fantasma) ───────────────────────────────────────────

  private updatePlacementGhost(event: PointerEvent): void {
    const placement = this.placement!
    this.ghostGroup.clear()
    this.placementValid = false
    this.placementPoint = null
    this.placementWallHit = null

    if (placement.type === 'furniture') {
      const hit = this.intersectFloorPlane(event, 0)
      if (!hit) return
      const support = surfaceAt(this.project, hit.x, hit.z)
      const y = support ? support.topY() : 0
      const inside = fitsInRoom(this.project.floorPlan, placement.item, hit.x, hit.z, 0)
      const ghost = buildGhost(placement.item, inside)
      ghost.position.set(hit.x, y + placement.item.height / 2, hit.z)
      this.ghostGroup.add(ghost)
      this.placementValid = inside
      this.placementPoint = new THREE.Vector3(hit.x, y, hit.z)
    } else if (placement.type === 'opening') {
      const wallHit = this.pickWallAt(event)
      if (!wallHit) return
      const { wall, point } = wallHit
      const probe = placement.kind === 'door' ? new Door(0, 0.9) : new Window(0, 1.2)
      const offset = slideOffset(wall, probe, point)
      const valid = wall.canPlaceOpening(probe, offset)
      const direction = wall.direction()
      const mid = offset + probe.width / 2
      const ghost = new THREE.Mesh(
        new THREE.BoxGeometry(probe.width, probe.height, wall.thickness + 0.06),
        new THREE.MeshStandardMaterial({
          color: valid ? 0x2e7d32 : 0xc0392b,
          transparent: true,
          opacity: 0.5,
        }),
      )
      ghost.position.set(
        wall.start.x + direction.x * mid,
        probe.sillHeight + probe.height / 2,
        wall.start.y + direction.y * mid,
      )
      ghost.rotation.y = -Math.atan2(direction.y, direction.x)
      this.ghostGroup.add(ghost)
      this.placementValid = valid
      this.placementWallHit = { wall, offset }
    } else {
      const planeY = placement.kind === 'ceiling' ? this.project.ceilingHeight : 0
      const hit = this.intersectFloorPlane(event, planeY)
      if (!hit) return
      let x = hit.x
      let z = hit.z
      let valid = this.isInsideRoom(x, z)
      if (placement.kind === 'wall') {
        const wall = this.project.floorPlan.wallAt(new Point2D(x, z), 1.0)
        if (!wall) valid = false
        else {
          const anchor = wall
            .segment()
            .pointAtDistance(wall.segment().projectDistance(new Point2D(x, z)))
          x = anchor.x
          z = anchor.y
          valid = true
        }
      }
      const y = placement.kind === 'ceiling' ? planeY : placement.kind === 'wall' ? 1.8 : 1.5
      const ghost = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 14, 12),
        new THREE.MeshStandardMaterial({
          color: valid ? 0xffd54a : 0xc0392b,
          transparent: true,
          opacity: 0.7,
        }),
      )
      ghost.position.set(x, y, z)
      this.ghostGroup.add(ghost)
      this.placementValid = valid
      this.placementPoint = new THREE.Vector3(x, y, z)
    }
  }

  private commitPlacement(): void {
    const placement = this.placement!
    if (!this.placementValid) {
      this.deps.onHint(
        placement.type === 'opening'
          ? 'Colócala sobre una pared libre.'
          : 'Ese sitio no vale: prueba dentro de la habitación.',
      )
      return
    }

    if (placement.type === 'furniture' && this.placementPoint) {
      const { x, z } = this.placementPoint
      const command = new PlaceFurnitureCommand(this.project, placement.item, x, z)
      this.deps.stack.execute(command)
      const placed = command.placed()
      if (placed) {
        dropFurniture(this.project, placed, x, z)
        this.select({ type: 'furniture', furniture: placed })
      }
    } else if (placement.type === 'opening' && this.placementWallHit) {
      const { wall, offset } = this.placementWallHit
      const opening =
        placement.kind === 'door' ? new Door(offset, 0.9) : new Window(offset, 1.2)
      this.deps.stack.execute(new AddOpeningCommand(this.project, wall, opening))
      this.select({ type: 'opening', wall, opening })
    } else if (placement.type === 'light' && this.placementPoint) {
      const { x, z } = this.placementPoint
      const light: LightPoint =
        placement.kind === 'ceiling'
          ? new CeilingLight(x, z, this.project.ceilingHeight)
          : placement.kind === 'wall'
            ? new WallLight(x, z, 1.8)
            : new FloorLamp(x, z, 1.5)
      this.deps.stack.execute(new AddLightCommand(this.project, light))
      this.select({ type: 'light', light })
    }

    this.setPlacement(null)
    this.deps.onPlacementDone()
  }

  // ── Raycasting ───────────────────────────────────────────────────────────

  private setRayFrom(event: PointerEvent): void {
    this.flushIfDirty()
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
  }

  private pickAt(event: PointerEvent): Pick | null {
    this.setRayFrom(event)
    const hits = this.raycaster.intersectObjects(this.roomGroup.children, true)
    for (const hit of hits) {
      const pick = pickOf(hit.object)
      // Las paredes desvanecidas son "transparentes" también para el ratón.
      if (pick?.type === 'wall' && this.fadedWalls.has(pick.wall)) continue
      if (pick) return pick
    }
    return null
  }

  private pickWallAt(event: PointerEvent): { wall: Wall; point: Point2D } | null {
    this.setRayFrom(event)
    const hits = this.raycaster.intersectObjects(this.roomGroup.children, true)
    for (const hit of hits) {
      const pick = pickOf(hit.object)
      if (pick?.type === 'wall' && !this.fadedWalls.has(pick.wall)) {
        return { wall: pick.wall, point: new Point2D(hit.point.x, hit.point.z) }
      }
    }
    return null
  }

  private intersectFloorPlane(event: PointerEvent, y: number): { x: number; z: number } | null {
    this.setRayFrom(event)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)
    const point = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(plane, point)) return null
    return { x: point.x, z: point.z }
  }

  private intersectWallPlane(event: PointerEvent, wall: Wall): Point2D | null {
    this.setRayFrom(event)
    const direction = wall.direction()
    const normal = new THREE.Vector3(-direction.y, 0, direction.x)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(wall.start.x, 0, wall.start.y),
    )
    const point = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(plane, point)) return null
    return new Point2D(point.x, point.z)
  }

  private isInsideRoom(x: number, z: number): boolean {
    const polygon = this.project.floorPlan.floorPolygon()
    return polygon ? polygon.contains(new Point2D(x, z)) : true
  }

  // ── Utilidades ───────────────────────────────────────────────────────────

  private roomCenter(): THREE.Vector3 {
    const walls = this.project.floorPlan.walls
    if (walls.length === 0) return new THREE.Vector3(2.5, 0, 2)
    let x = 0
    let z = 0
    for (const wall of walls) {
      x += wall.start.x + wall.end.x
      z += wall.start.y + wall.end.y
    }
    return new THREE.Vector3(x / (walls.length * 2), 0, z / (walls.length * 2))
  }

  private roomRadius(): number {
    const walls = this.project.floorPlan.walls
    const center = this.roomCenter()
    let radius = 3
    for (const wall of walls) {
      radius = Math.max(radius, Math.hypot(wall.start.x - center.x, wall.start.y - center.z))
    }
    return radius
  }
}

function sameSelectable(a: Selectable | null, b: Selectable | null): boolean {
  if (a === b) return true
  if (!a || !b || a.type !== b.type) return false
  if (a.type === 'furniture' && b.type === 'furniture') return a.furniture === b.furniture
  if (a.type === 'opening' && b.type === 'opening') return a.opening === b.opening
  if (a.type === 'light' && b.type === 'light') return a.light === b.light
  return false
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of materials) material.dispose()
    }
  })
}
