import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // Mock obsidian API for tests / Mock obsidian API 用于测试
      obsidian: new URL('tests/mocks/obsidian.ts', import.meta.url).pathname,
    },
  },
});
