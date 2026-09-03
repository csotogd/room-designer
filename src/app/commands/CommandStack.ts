import type { Command } from './Command'

/** Pila de undo/redo: ejecutar un comando nuevo borra el historial de redo. */
export class CommandStack {
  /** Tope de historial: sin él, cada comando ancla sus objetos en memoria para siempre. */
  private static readonly MAX_DEPTH = 200
  private readonly undoStack: Command[] = []
  private readonly redoStack: Command[] = []

  execute(command: Command): void {
    command.execute()
    this.undoStack.push(command)
    if (this.undoStack.length > CommandStack.MAX_DEPTH) this.undoStack.shift()
    this.redoStack.length = 0
  }

  /**
   * Vacía el historial. Obligatorio al cambiar de proyecto: los comandos
   * capturan referencias al proyecto anterior y deshacer mutaría un agregado
   * ya descartado (no-op invisible para quien usa la app).
   */
  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }

  undo(): void {
    const command = this.undoStack.pop()
    if (!command) return
    command.undo()
    this.redoStack.push(command)
  }

  redo(): void {
    const command = this.redoStack.pop()
    if (!command) return
    command.execute()
    this.undoStack.push(command)
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }
}
