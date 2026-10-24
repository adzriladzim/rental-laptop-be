import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/api/**/*.spec.ts'],
    environment: 'node',
    globals: false,
  },
})
