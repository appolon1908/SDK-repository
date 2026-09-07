import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../../src/db/prisma.js";
import { loadEnv, type Env } from "../../src/env.js";
import { JwtAuthenticator } from "../../src/auth/jwt.js";
import { PrismaIdempotencyStore } from "../../src/idempotency/prisma-store.js";
import { RestrictedGatewayClient } from "../../src/connectors/restricted-gateway-client.js";
import { buildServer } from "../../src/server.js";
import { TestJwksServer } from "./jwks-server.js";

export interface TestContext {
  app: FastifyInstance;
  prisma: PrismaClient;
  env: Env;
  jwks: TestJwksServer;
  restrictedGatewayBaseUrl: string;
  createTenant: () => Promise<string>;
  authHeader: (tenantId: string, overrides?: Parameters<TestJwksServer["issueToken"]>[0]) => Promise<string>;
  close: () => Promise<void>;
}

export async function createTestContext(
  options: {
    restrictedGatewayBaseUrl?: string;
    allowInsecureWebhookDestinationsForTests?: boolean;
    rateLimitMax?: number;
    trustedProxyCidrs?: string;
  } = {},
): Promise<TestContext> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set to run services/middleware integration tests.");

  const jwks = new TestJwksServer();
  await jwks.start();

  const env = loadEnv({
    ...process.env,
    OIDC_ISSUER: jwks.issuer,
    OIDC_JWKS_URL: jwks.url,
    OIDC_AUDIENCE: jwks.audience,
    OIDC_TENANT_CLAIM: "tenant_id",
    RESTRICTED_GATEWAY_BASE_URL: options.restrictedGatewayBaseUrl ?? "https://product-gateway.invalid",
    RESTRICTED_GATEWAY_SERVICE_TOKEN: "test-service-token",
    // Off by default, exactly like production. Tests that dispatch to a
    // local FakeWebhookReceiver opt in explicitly.
    WEBHOOK_SSRF_ALLOW_INSECURE_FOR_TESTS: options.allowInsecureWebhookDestinationsForTests ? "true" : "false",
    ...(options.rateLimitMax === undefined ? {} : { RATE_LIMIT_MAX: String(options.rateLimitMax) }),
    ...(options.trustedProxyCidrs === undefined ? {} : { TRUSTED_PROXY_CIDRS: options.trustedProxyCidrs }),
  });

  const prisma = createPrismaClient(env.DATABASE_URL);
  const idempotencyStore = new PrismaIdempotencyStore(prisma);
  const jwtAuthenticator = new JwtAuthenticator(env);
  const restrictedGatewayClient = new RestrictedGatewayClient(env);

  const app = await buildServer({ env, prisma, idempotencyStore, jwtAuthenticator, restrictedGatewayClient, logger: false });
  await app.ready();

  const createTenant = async (): Promise<string> => {
    const tenant = await prisma.tenant.create({ data: { id: randomUUID() } });
    return tenant.id;
  };

  const authHeader = async (tenantId: string, overrides: Parameters<TestJwksServer["issueToken"]>[0] = {}): Promise<string> => {
    const token = await jwks.issueToken({ tenantId, ...overrides });
    return `Bearer ${token}`;
  };

  const close = async (): Promise<void> => {
    await app.close();
    await prisma.$disconnect();
    await jwks.stop();
  };

  return { app, prisma, env, jwks, restrictedGatewayBaseUrl: env.RESTRICTED_GATEWAY_BASE_URL, createTenant, authHeader, close };
}

export function idempotencyKey(): string {
  return `test-idem-${randomUUID()}`;
}
