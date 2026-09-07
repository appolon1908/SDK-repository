import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: [
      "test/**/*.test.ts",
      "packages/**/test/**/*.test.ts",
      "integrations/**/test/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/test/pact/**",
      "**/*.redis.test.ts",
    ],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "packages/contracts/src/**/*.ts",
        "packages/social-sdk/src/**/*.ts",
        "packages/webhook-sdk/src/**/*.ts",
        "packages/connector-kit/src/**/*.ts",
        "packages/provider-adapters/src/**/*.ts",
        "packages/svix-delivery/src/**/*.ts",
        "integrations/n8n-nodes/src/**/*.ts",
      ],
      exclude: ["**/*.d.ts"],
      thresholds: {
        statements: 20,
        branches: 15,
        functions: 20,
        lines: 20,
      },
    },
  },
});
