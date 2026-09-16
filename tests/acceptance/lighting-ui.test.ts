// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import { scenario } from './gherkin'

scenario('The editor has no time of day control', () => {
  document.body.innerHTML = readFileSync('index.html', 'utf8')

  expect(document.querySelector('.time-group, #time-slider, #time-value')).toBeNull()
})
