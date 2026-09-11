import type { ProjectDoc } from '../serialization/ProjectSerializer'
import type { ProjectRepository } from './ProjectRepository'

const STORAGE_KEY = 'room-designer-project'

/** Lo mínimo que necesitamos de Storage, para poder inyectar uno falso en tests. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class LocalStorageProjectRepository implements ProjectRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  // async: un QuotaExceededError o un JSON corrupto deben rechazar la
  // promesa (y llegar al .catch de quien llama), no escapar síncronos.
  async save(doc: ProjectDoc): Promise<void> {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(doc))
  }

  async load(): Promise<ProjectDoc | null> {
    const raw = this.storage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ProjectDoc) : null
  }
}
