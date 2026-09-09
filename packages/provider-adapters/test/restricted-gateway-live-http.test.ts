import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConnectorContext } from "@codestra/connector-kit";
import type { RestrictedGatewayAdapterConfig } from "../src/base.js";
import { PostizAdapter } from "../src/index.js";
import { FakeRestrictedGateway, sendJson } from "./support/fake-restricted-gateway.js";

/**
 * adapters.test.ts proves RestrictedGatewayAdapter's request/response
 * handling against a mocked `fetch` that never touches a socket. That
 * leaves everything about *real* HTTP transport unverified: whether
 * `redirect: "error"` actually stops a real redirect, whether the
 * configured timeout aborts a real connection, how a real connection
 * reset surfaces, and whether headers this class builds actually arrive
 * on the wire. This file exercises the same adapter against a real
 * loopback HTTP server (services/middleware's connectors.test.ts does the
 * same for its own, independent RestrictedGatewayClient implementation).
 */

const context: ConnectorContext = {
  tenantId: "2b78b66e-40d9-4dd0-884b-d5cbd3773d04",
  correlationId: "correlation-live-0001",
  actor: { type: "service", subjectId: "middleware" },
  capabilities: { "social.write": true, "social.external_delivery": true },
};

const command = {
  commandId: "4fab632d-0a69-4d28-8eb1-982bc92cf613",
  operation: "social.post.create",
  payload: { text: "Hello" },
  requestedAt: "2026-08-27T00:00:00Z",
  idempotencyKey: "idempotency-key-live-0001",
};

let gateway: FakeRestrictedGateway;

beforeAll(async () => {
  gateway = new FakeRestrictedGateway(() => {
    throw new Error("handler not configured");
  });
  await gateway.start();
});

afterEach(() => {
  gateway.setHandler(() => {
    throw new Error("handler not configured");
  });
});

afterAll(async () => {
  await gateway.stop();
});

function adapter(overrides: Partial<RestrictedGatewayAdapterConfig> = {}) {
  return new PostizAdapter({
    baseUrl: gateway.url,
    tokenProvider: () => "secret-token",
    workloadIdentity: "middleware-worker-1",
    enabled: true,
    enabledOperations: ["social.post.create"],
    timeoutMs: 300,
    // This file exercises real transport (redirects, resets, timeouts), not
    // retry/backoff semantics -- those are covered against a mocked fetch in
    // adapters.test.ts, where delays can be skipped deterministically.
    // Retrying here would only make every failure-path test slower.
    maxRetries: 0,
    ...overrides,
  });
}

describe("RestrictedGatewayAdapter against a real HTTP server", () => {
  it("sends real headers and body over the wire and parses a real JSON response", async () => {
    let received: { headers: Record<string, unknown>; body: unknown; method: string; path: string } | undefined;
    gateway.setHandler((request, response) => {
      received = request;
      sendJson(response, 200, {
        commandId: (request.body as { commandId: string }).commandId,
        status: "accepted",
        providerReference: "postiz-job-1",
      });
    });

    await expect(adapter().execute(context, command)).resolves.toMatchObject({
      commandId: command.commandId,
      status: "accepted",
      providerReference: "postiz-job-1",
    });

    expect(received?.method).toBe("POST");
    expect(received?.path).toBe("/internal/v1/codestra/commands");
    expect(received?.headers["x-codestra-tenant-id"]).toBe(context.tenantId);
    expect(received?.headers["x-correlation-id"]).toBe(context.correlationId);
    expect(received?.headers["x-codestra-workload-id"]).toBe("middleware-worker-1");
    expect(received?.headers["authorization"]).toBe("Bearer secret-token");
    expect(received?.headers["idempotency-key"]).toBe(command.idempotencyKey);
    expect(received?.body).toMatchObject({ commandId: command.commandId, operation: "social.post.create" });
  });

  it("surfaces a retryable error for a real HTTP 503 response", async () => {
    gateway.setHandler((_request, response) => {
      sendJson(response, 503, { error: { code: "UPSTREAM_UNAVAILABLE", message: "try later" } });
    });

    await expect(adapter().execute(context, command)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });

  it("rejects a real non-JSON success response instead of trusting the status code", async () => {
    gateway.setHandler((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });

    await expect(adapter().execute(context, command)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });

  it("surfaces a retryable network error when the connection resets mid-response", async () => {
    gateway.setHandler((_request, response) => {
      response.destroy();
    });

    await expect(adapter().execute(context, command)).rejects.toMatchObject({
      code: "PROVIDER_NETWORK_ERROR",
      retryable: true,
    });
  });

  it("refuses to follow a real redirect rather than leaking the request to another host", async () => {
    // The redirect target is a second real server we control, not an
    // unreachable domain: pointing Location at a host that merely fails to
    // resolve would make this pass even if redirect: "error" were dropped
    // (a followed redirect and a rejected one both end in the same
    // PROVIDER_NETWORK_ERROR via a DNS failure). Asserting this server
    // never receives a request is what actually proves the redirect was
    // never followed.
    const redirectTarget = new FakeRestrictedGateway(() => {
      throw new Error("handler not configured");
    });
    await redirectTarget.start();
    let redirectTargetHit = false;
    redirectTarget.setHandler((_request, response) => {
      redirectTargetHit = true;
      sendJson(response, 200, { commandId: command.commandId, status: "accepted" });
    });

    try {
      gateway.setHandler((_request, response) => {
        response.writeHead(302, { location: `${redirectTarget.url}/internal/v1/codestra/commands` });
        response.end();
      });

      await expect(adapter().execute(context, command)).rejects.toMatchObject({
        code: "PROVIDER_NETWORK_ERROR",
      });
      expect(redirectTargetHit).toBe(false);
    } finally {
      await redirectTarget.stop();
    }
  });

  it("aborts with a retryable timeout when the server never responds", async () => {
    gateway.setHandler(() => {
      // Never call response.end() — simulates a hung upstream.
    });

    await expect(adapter({ timeoutMs: 150 }).execute(context, command)).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_ABORTED",
      retryable: true,
    });
  });

  it("reports real measured latency from a healthy connection test", async () => {
    gateway.setHandler((_request, response) => {
      sendJson(response, 200, { status: "ok" });
    });

    const health = await adapter().testConnection(context);
    expect(health.status).toBe("healthy");
    expect(typeof health.latencyMs).toBe("number");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a degraded (retryable) connection test against a real connection reset", async () => {
    gateway.setHandler((_request, response) => {
      response.destroy();
    });

    const health = await adapter().testConnection(context);
    expect(health.status).toBe("degraded");
  });

  it("reconciles a real paginated response from the gateway", async () => {
    gateway.setHandler((request, response) => {
      expect(request.path).toBe("/internal/v1/codestra/reconciliation");
      sendJson(response, 200, { items: [{ externalId: "1" }], hasMore: false });
    });

    await expect(adapter().reconcile(context)).resolves.toEqual({
      items: [{ externalId: "1" }],
      hasMore: false,
    });
  });
});
