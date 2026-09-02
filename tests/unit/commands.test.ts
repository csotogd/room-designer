import { describe, expect, test } from 'vitest'
import { CommandStack } from '../../src/app/commands/CommandStack'
import type { Command } from '../../src/app/commands/Command'

function counter() {
  const state = { value: 0 }
  const inc: Command = {
    execute: () => void (state.value += 1),
    undo: () => void (state.value -= 1),
  }
  return { state, inc }
}

describe('CommandStack', () => {
  test('execute runs the command and enables undo', () => {
    const { state, inc } = counter()
    const stack = new CommandStack()
    stack.execute(inc)
    expect(state.value).toBe(1)
    expect(stack.canUndo()).toBe(true)
  })

  test('undo reverses, redo re-applies', () => {
    const { state, inc } = counter()
    const stack = new CommandStack()
    stack.execute(inc)
    stack.undo()
    expect(state.value).toBe(0)
    expect(stack.canRedo()).toBe(true)
    stack.redo()
    expect(state.value).toBe(1)
  })

  test('a new command clears the redo history', () => {
    const { inc } = counter()
    const stack = new CommandStack()
    stack.execute(inc)
    stack.undo()
    stack.execute(inc)
    expect(stack.canRedo()).toBe(false)
  })

  test('undo/redo on empty stacks are safe no-ops', () => {
    const stack = new CommandStack()
    expect(() => stack.undo()).not.toThrow()
    expect(() => stack.redo()).not.toThrow()
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(false)
  })
})
