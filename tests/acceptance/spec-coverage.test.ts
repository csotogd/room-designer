import { describe, expect, test } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FEATURES_DIR = join(HERE, '../../specs/features')
const ACCEPTANCE_DIR = HERE

function scenariosInFeatures(): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const file of readdirSync(FEATURES_DIR).filter((f) => f.endsWith('.feature'))) {
    const text = readFileSync(join(FEATURES_DIR, file), 'utf8')
    const names = [...text.matchAll(/^\s*Scenario:\s*(.+?)\s*$/gm)].map((m) => m[1]!)
    result.set(file, names)
  }
  return result
}

function scenariosInTests(): Set<string> {
  const names = new Set<string>()
  for (const file of readdirSync(ACCEPTANCE_DIR).filter((f) => f.endsWith('.test.ts'))) {
    const text = readFileSync(join(ACCEPTANCE_DIR, file), 'utf8')
    for (const m of text.matchAll(/scenario\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      names.add(m[2]!)
    }
  }
  return names
}

describe('Spec coverage gate', () => {
  test('every Gherkin scenario has an acceptance test', () => {
    const implemented = scenariosInTests()
    const missing: string[] = []
    for (const [file, names] of scenariosInFeatures()) {
      for (const name of names) {
        if (!implemented.has(name)) missing.push(`${file}: ${name}`)
      }
    }
    expect(missing, `Escenarios sin test de aceptación:\n${missing.join('\n')}`).toEqual([])
  })

  test('there is at least one feature file', () => {
    expect(scenariosInFeatures().size).toBeGreaterThan(0)
  })
})
