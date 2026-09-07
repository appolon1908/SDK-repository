import { defineConfig } from "vitest/config";
export default defineConfig({ test: {
  include: ["integrations/n8n-nodes/test/*.redis.test.ts"],
  testTimeout: 20000, hookTimeout: 60000,
} });
