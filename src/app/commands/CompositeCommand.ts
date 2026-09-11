import type { Command } from './Command'

/**
 * Varias ediciones como una sola transacción de undo: todo el turno del
 * chat del diseñador se deshace con UN Ctrl+Z. Si un sub-comando falla a
 * mitad, se revierte el prefijo ya ejecutado antes de propagar el error —
 * nunca queda una mutación parcial sin entrada en el historial.
 */
export class CompositeCommand implements Command {
  constructor(private readonly commands: Command[]) {}

  get size(): number {
    return this.commands.length
  }

  execute(): void {
    const done: Command[] = []
    try {
      for (const command of this.commands) {
        command.execute()
        done.push(command)
      }
    } catch (error) {
      for (let i = done.length - 1; i >= 0; i--) done[i]!.undo()
      throw error
    }
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i]!.undo()
  }
}
