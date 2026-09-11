import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DesignAction, LoggedAction, RoomStateFile } from './types'

/**
 * El fichero de la habitación: estado actual + log de cambios, en un único
 * JSON. Escritura atómica (tmp + rename), como el resto de fuentes de verdad
 * del repo: un proceso caído a medias nunca deja el fichero corrupto.
 */

export function emptyRoomState(): RoomStateFile {
  return { version: 1, room: null, openings: [], items: [], log: [] }
}

export async function loadRoomState(path: string): Promise<RoomStateFile> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return emptyRoomState() // sin fichero todavía: habitación nueva
  }
  // Corrupción ≠ fichero ausente: fallar ruidosamente, no vaciar la sala.
  const parsed = JSON.parse(raw) as RoomStateFile
  if (parsed.version !== 1) throw new Error(`Versión de room file no soportada: ${parsed.version}`)
  return parsed
}

export async function saveRoomState(path: string, state: RoomStateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2))
  await rename(tmp, path)
}

/**
 * Aplica una acción al estado EN MEMORIA y la añade al log. El estado y su
 * log viajan juntos: reproducir el log desde cero reconstruye el estado.
 */
export function applyAction(
  state: RoomStateFile,
  action: DesignAction,
  meta: { requestId: string; source: LoggedAction['source']; at: string },
): void {
  switch (action.kind) {
    case 'setRoom':
      state.room = action.room
      state.openings = action.openings
      // Redimensionar no borra los muebles: los guardrails recolocan/rechazan.
      break
    case 'placeNew':
      state.items.push({
        uid: action.uid,
        productId: action.productId,
        x: action.x,
        y: 0,
        z: action.z,
        rotDeg: action.rotDeg,
      })
      break
    case 'replace': {
      const item = state.items.find((i) => i.uid === action.uid)
      if (!item) throw new Error(`replace: uid desconocido ${action.uid}`)
      item.productId = action.productId
      item.x = action.x
      item.z = action.z
      item.rotDeg = action.rotDeg
      break
    }
    case 'move': {
      const item = state.items.find((i) => i.uid === action.uid)
      if (!item) throw new Error(`move: uid desconocido ${action.uid}`)
      item.x = action.x
      item.z = action.z
      break
    }
    case 'rotate': {
      const item = state.items.find((i) => i.uid === action.uid)
      if (!item) throw new Error(`rotate: uid desconocido ${action.uid}`)
      item.rotDeg = action.rotDeg
      break
    }
    case 'remove': {
      const index = state.items.findIndex((i) => i.uid === action.uid)
      if (index < 0) throw new Error(`remove: uid desconocido ${action.uid}`)
      state.items.splice(index, 1)
      break
    }
  }
  state.log.push({ at: meta.at, source: meta.source, requestId: meta.requestId, action })
}

export function defaultRoomFilePath(): string {
  const site = process.env.CATALOG_SITE ?? 'sklum'
  return (
    process.env.DESIGNER_ROOM_FILE ?? join(process.cwd(), 'data', 'designer', `room-${site}.json`)
  )
}
