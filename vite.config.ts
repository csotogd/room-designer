import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5173 },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/app/**'],
      // Umbrales de CI (medidos: ~93% líneas, ~82% ramas). Si bajan de aquí,
      // el build rompe: son puertas, no métricas decorativas.
      thresholds: {
        lines: 88,
        functions: 88,
        statements: 88,
        branches: 75,
      },
    },
  },
})
