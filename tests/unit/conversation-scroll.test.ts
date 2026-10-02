// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { ConversationScroll } from '../../src/ui/panels/ConversationScroll'

test('mantiene la posición al leer mensajes anteriores', () => {
  const messages = document.createElement('div')
  Object.defineProperties(messages, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } })
  const scroll = new ConversationScroll(messages)
  messages.scrollTop = 200
  messages.dispatchEvent(new Event('scroll'))
  scroll.afterAppend()
  expect(messages.scrollTop).toBe(200)
})
