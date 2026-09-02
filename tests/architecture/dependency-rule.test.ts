import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '../../src')

function tsFilesUnder(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) result.push(...tsFilesUnder(path))
    else if (entry.endsWith('.ts')) result.push(path)
  }
  return result
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)
}

describe('Regla de dependencias (ui → app → core, nunca al revés)', () => {
  test('core no importa de app, ui, three ni de ningún paquete externo', () => {
    const violations: string[] = []
    for (const file of tsFilesUnder(join(SRC, 'core'))) {
      for (const spec of importsOf(file)) {
        const isRelative = spec.startsWith('.')
        const escapesCore = isRelative && spec.includes('/app/')
        const escapesToUi = isRelative && spec.includes('/ui/')
        if (!isRelative || escapesCore || escapesToUi) {
          violations.push(`${file.replace(SRC, 'src')} importa "${spec}"`)
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  test('app no importa de ui', () => {
    const violations: string[] = []
    for (const file of tsFilesUnder(join(SRC, 'app'))) {
      for (const spec of importsOf(file)) {
        if (spec.includes('/ui/')) violations.push(`${file.replace(SRC, 'src')} importa "${spec}"`)
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  test('app solo depende de core y de sí misma (sin three ni DOM libs)', () => {
    const violations: string[] = []
    for (const file of tsFilesUnder(join(SRC, 'app'))) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) violations.push(`${file.replace(SRC, 'src')} importa "${spec}"`)
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })
})
