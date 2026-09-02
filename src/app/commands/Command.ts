/** Toda mutación del usuario es un comando reversible. */
export interface Command {
  execute(): void
  undo(): void
}
