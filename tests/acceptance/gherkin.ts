import { describe, test } from 'vitest'

/**
 * Arnés mínimo de aceptación: cada test de aceptación se declara con el nombre
 * EXACTO del escenario del .feature. El test spec-coverage.test.ts verifica que
 * ningún escenario de specs/features/ se queda sin implementar.
 */
export function feature(name: string, fn: () => void): void {
  describe(`Feature: ${name}`, fn)
}

export function scenario(name: string, fn: () => void | Promise<void>): void {
  test(`Scenario: ${name}`, fn)
}
