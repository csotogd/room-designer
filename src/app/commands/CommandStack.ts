import type { Command } from './Command'

/** Pila de undo/redo: ejecutar un comando nuevo borra el historial de redo. */
export class CommandStack {
  private readonly undoStack: Command[] = []
  private readonly redoStack: Command[] = []

  execute(command: Command): void {
    command.execute()
    this.undoStack.push(command)
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
