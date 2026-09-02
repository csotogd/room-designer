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

  save(doc: ProjectDoc): Promise<void> {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(doc))
    return Promise.resolve()
  }

  load(): Promise<ProjectDoc | null> {
    const raw = this.storage.getItem(STORAGE_KEY)
    return Promise.resolve(raw ? (JSON.parse(raw) as ProjectDoc) : null)
  }
}
