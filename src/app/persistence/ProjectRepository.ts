import type { ProjectDoc } from '../serialization/ProjectSerializer'

/**
 * Puerto de persistencia de proyectos. Hoy lo implementa localStorage; en
 * producción, un adaptador gRPC contra ProjectService (ver ARCHITECTURE.md)
 * implementa esta misma interfaz sin tocar el resto de la app.
 */
export interface ProjectRepository {
  save(doc: ProjectDoc): Promise<void>
  load(): Promise<ProjectDoc | null>
}
