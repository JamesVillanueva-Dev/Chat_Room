import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // A fork per file gives each test file its own in-memory database and its
    // own module registry, so suites cannot leak state into each other.
    pool: 'forks',
    include: ['tests/**/*.test.js'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      SESSION_SECRET: 'test-secret',
      // Tests fire messages far faster than a person would. The limiter itself
      // is covered by its own unit tests and by a realtime test that lowers the
      // ceiling deliberately, so a high default keeps it out of the way here.
      RATE_LIMIT_MAX_MESSAGES: '1000',
      UNFURL_ENABLED: '0',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    // Sockets and child processes need a moment to unwind.
    teardownTimeout: 10000,
  },
});
