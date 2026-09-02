import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5173 },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/app/**'],
    },
  },
})
