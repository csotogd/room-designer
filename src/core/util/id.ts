let counter = 0

/** Identificador único para entidades del dominio. */
export function newId(prefix: string): string {
  counter += 1
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffffffff).toString(16)
  return `${prefix}-${counter}-${random}`
}
