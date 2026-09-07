import { describe, expect, it, vi } from "vitest";
import {
  CapabilityDisabledError,
  CodestraSdkConfigurationError,
  UnknownOutcomeError,
  createCodestraSdk,
} from "../src/index.js";

const tenantId = "tenant-001";
const correlationId = "correlation-0001";
const idempotencyKey = "stable-idempotency-0001";

describe("codestra_sdk facade", () => {
  it("exposes the canonical domain module layout", () => {
    const sdk = testSdk(vi.fn<typeof fetch>());

    expect(sdk).toHaveProperty("platform");
    expect(sdk).toHaveProperty("operations");
    expect(sdk).toHaveProperty("control");
    expect(sdk).toHaveProperty("marketing");
    expect(sdk).toHaveProperty("ai");
    expect(sdk).toHaveProperty("communication");
    expect(sdk).toHaveProperty("social");
    expect(sdk).toHaveProperty("automation");
    expect(sdk).toHaveProperty("operationsDashboard");
    expect(sdk).toHaveProperty("events");
    expect(sdk).toHaveProperty("common");
  });

  it("uses canonical Middleware command and operation routes", async () => {
    const operationId = "d0313dba-09f7-4cce-8894-195f72c62126";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(200, { operation_id: operationId, state: "QUEUED" }));
    const sdk = testSdk(fetchMock);

    await sdk.control.marketing.submit(
      {
        commandType: "marketing.campaign.create.v1",
        target: "marketing",
        capability: "MARKETING_WRITE",
        payload: { name: "Safe draft" },
      },
      { idempotencyKey },
    );
    await sdk.control.ai.get(operationId);
    await sdk.control.crm.reconcile(
      operationId,
      { expected_version: 2, reason: "provider readback complete" },
      { idempotencyKey },
    );
    await sdk.control.n8n.list({ state: "RECONCILIATION_REQUIRED", limit: 25 });
    await sdk.control.marketing.list({ correlationId: "domain-list-correlation" });

    expect(pathname(fetchMock, 0)).toBe("/v1/marketing/commands");
    expect(pathname(fetchMock, 1)).toBe(`/v1/ai/operations/${operationId}`);
    expect(pathname(fetchMock, 2)).toBe(`/v1/crm/operations/${operationId}/reconcile`);
    expect(new URL(String(fetchMock.mock.calls[3]?.[0])).pathname).toBe("/v1/integrations/n8n/operations");
    expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[3]?.[0])).searchParams)).toEqual({
      limit: "25",
      state: "RECONCILIATION_REQUIRED",
    });
    expect(new URL(String(fetchMock.mock.calls[4]?.[0])).search).toBe("");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      command_id: operationId,
      command_type: "marketing.campaign.create.v1",
      command_version: "1.0",
      target: "marketing",
      tenant_id: tenantId,
      requested_by: "moneybee-backend",
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
      capability: "MARKETING_WRITE",
      payload: { name: "Safe draft" },
    });
    expect(headersFor(fetchMock, 0).get("idempotency-key")).toBe(idempotencyKey);
  });

  it("exposes canonical platform and global operation reads", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(200, {}));
    const sdk = testSdk(fetchMock);
    await sdk.platform.health();
    await sdk.platform.readiness();
    await sdk.platform.version();
    await sdk.platform.dependencies();
    await sdk.platform.capabilities();
    await sdk.operations.list({ limit: 10, state: "UNKNOWN" });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/health",
      "/readiness",
      "/version",
      "/dependencies",
      "/capabilities",
      "/v1/operations",
    ]);
  });

  it("rejects malformed canonical commands before network activity", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const sdk = testSdk(fetchMock);
    expect(() =>
      sdk.control.odoo.submit(
        { commandType: "invalid", target: "odoo-19", capability: "ODOO_WRITE", payload: {} },
        { idempotencyKey },
      ),
    ).toThrow(CodestraSdkConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts contract-valid UUID versions beyond the legacy v1-v5 range", async () => {
    const operationId = "01890f47-7a5b-7cc1-9d21-8cb3e8f2c001";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse(200, { operation_id: operationId, state: "QUEUED" }),
    );
    const sdk = testSdk(fetchMock);

    await sdk.operations.get(operationId);
    expect(pathname(fetchMock, 0)).toBe(`/v1/operations/${operationId}`);
  });

  it("enforces the canonical 8-to-180 character idempotency-key bounds", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse(202, { operation_id: "d0313dba-09f7-4cce-8894-195f72c62126", state: "QUEUED" }),
    );
    const sdk = testSdk(fetchMock);
    const command = {
      commandType: "marketing.campaign.create.v1",
      target: "marketing",
      capability: "MARKETING_WRITE",
      payload: { name: "Safe draft" },
    };

    await sdk.control.marketing.submit(command, { idempotencyKey: "12345678" });
    await sdk.control.marketing.submit(command, { idempotencyKey: "x".repeat(180) });
    expect(() => sdk.control.marketing.submit(command, { idempotencyKey: "1234567" })).toThrow(
      "idempotencyKey must contain between 8 and 180 characters.",
    );
    expect(() => sdk.control.marketing.submit(command, { idempotencyKey: "x".repeat(181) })).toThrow(
      "idempotencyKey must contain between 8 and 180 characters.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves legacy idempotency-key bounds on legacy calls", () => {
    const sdk = testSdk(vi.fn<typeof fetch>());

    expect(() => sdk.ai.generate({ task: "summarize", input: "Summarize this lead." }, { idempotencyKey: "12345678" })).toThrow(
      "idempotencyKey must contain between 16 and 128 characters.",
    );
    expect(() => sdk.ai.generate({ prompt: "Summarize this lead." }, { idempotencyKey: "x".repeat(129) })).toThrow(
      "idempotencyKey must contain between 16 and 128 characters.",
    );
  });

  it("preserves canonical idempotency-key bounds on automation commands", () => {
    const sdk = testSdk(vi.fn<typeof fetch>());

    expect(() => sdk.automation.commands.trigger({ workflowKey: "lead-intake" }, { idempotencyKey: "1234567" })).toThrow(
      "idempotencyKey must contain between 8 and 180 characters.",
    );
    expect(() =>
      sdk.automation.commands.trigger({ workflowKey: "lead-intake" }, { idempotencyKey: "x".repeat(181) }),
    ).toThrow("idempotencyKey must contain between 8 and 180 characters.");
  });

  it("preserves unknown outcomes as a typed read-back-required error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse(409, {
        error: {
          code: "UNKNOWN_PROVIDER_OUTCOME",
          message: "Read back provider state before retrying.",
          request_id: "request-001",
          correlation_id: correlationId,
          operation_id: "d0313dba-09f7-4cce-8894-195f72c62126",
          retryable: false,
        },
      }),
    );
    const sdk = testSdk(fetchMock);
    await expect(sdk.operations.get("d0313dba-09f7-4cce-8894-195f72c62126")).rejects.toMatchObject({
      name: "UnknownOutcomeError",
      code: "UNKNOWN_PROVIDER_OUTCOME",
      retryable: false,
      correlationId,
      operationId: "d0313dba-09f7-4cce-8894-195f72c62126",
    });
    await expect(sdk.operations.get("d0313dba-09f7-4cce-8894-195f72c62126")).rejects.toBeInstanceOf(UnknownOutcomeError);
  });

  it("classifies a disabled capability before the generic forbidden status", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse(403, {
        error: {
          code: "CAPABILITY_DISABLED",
          message: "External delivery is disabled.",
          request_id: "request-capability-001",
          retryable: false,
        },
      }),
    );
    const sdk = testSdk(fetchMock);

    await expect(sdk.platform.capabilities()).rejects.toBeInstanceOf(CapabilityDisabledError);
  });

  it("supports stable product-facing calls across current domains", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { output: "done" }))
      .mockResolvedValueOnce(jsonResponse(202, { messageId: "message-001" }))
      .mockResolvedValueOnce(jsonResponse(202, socialPost()));
    const sdk = testSdk(fetchMock);

    await sdk.marketing.campaigns.list();
    await sdk.ai.generate({ task: "summarize", input: "Summarize this lead." }, { idempotencyKey });
    await sdk.communication.messages.send(
      { channel: "email", to: ["customer@example.com"], content: { subject: "Hi", text: "Hello" } },
      { idempotencyKey },
    );
    await sdk.social.posts.schedule(
      {
        workspaceId: "204ddc3a-3a33-445f-bfc5-0bb15167b624",
        channels: ["linkedin"],
        content: { text: "Launch update" },
        publishAt: "2026-08-30T18:00:00Z",
      },
      { idempotencyKey },
    );

    expect(pathname(fetchMock, 0)).toBe("/v1/marketing/campaigns");
    expect(pathname(fetchMock, 1)).toBe("/v1/ai/generate");
    expect(pathname(fetchMock, 2)).toBe("/v1/communications/messages");
    expect(pathname(fetchMock, 3)).toBe("/v1/social/posts");
    expect(headersFor(fetchMock, 1).get("x-codestra-tenant-id")).toBe(tenantId);
    expect(headersFor(fetchMock, 1).get("x-tenant-id")).toBe(tenantId);
    expect(headersFor(fetchMock, 2).get("x-tenant-id")).toBe(tenantId);
    expect(headersFor(fetchMock, 3).get("x-codestra-tenant-id")).toBe(tenantId);
  });

  it("exposes read-only operations dashboard endpoints", async () => {
    const dashboardResponse = {
      schemaVersion: "1.0",
      checkedAt: "2026-08-30T00:00:00Z",
      tenantId,
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(200, dashboardResponse));
    const sdk = testSdk(fetchMock);

    await sdk.operationsDashboard.overview();
    await sdk.operationsDashboard.authGateway();
    await sdk.operationsDashboard.routes();
    await sdk.operationsDashboard.providers();
    await sdk.operationsDashboard.messageLifecycle();
    await sdk.operationsDashboard.webhooks();
    await sdk.operationsDashboard.tenant("tenant-002");
    await sdk.operationsDashboard.queues();
    await sdk.operationsDashboard.releaseGates();
    await sdk.operationsDashboard.canaries();

    expect(pathname(fetchMock, 0)).toBe("/v1/operations-dashboard/overview");
    expect(pathname(fetchMock, 1)).toBe("/v1/operations-dashboard/auth-gateway");
    expect(pathname(fetchMock, 2)).toBe("/v1/operations-dashboard/routes");
    expect(pathname(fetchMock, 3)).toBe("/v1/operations-dashboard/providers");
    expect(pathname(fetchMock, 4)).toBe("/v1/operations-dashboard/messages/lifecycle");
    expect(pathname(fetchMock, 5)).toBe("/v1/operations-dashboard/webhooks");
    expect(pathname(fetchMock, 6)).toBe("/v1/operations-dashboard/tenants/tenant-002");
    expect(pathname(fetchMock, 7)).toBe("/v1/operations-dashboard/queues");
    expect(pathname(fetchMock, 8)).toBe("/v1/operations-dashboard/release-gates");
    expect(pathname(fetchMock, 9)).toBe("/v1/operations-dashboard/canaries");
    expect(headersFor(fetchMock, 0).get("x-tenant-id")).toBe(tenantId);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("certifies endpoint and credential hygiene for unified facade requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { runId: "run-001" }));
    const sdk = testSdk(fetchMock);

    await sdk.automation.commands.trigger(
      { workflowKey: "lead-intake", payload: { source: "sdk-test" } },
      { idempotencyKey, correlationId: "correlation-explicit-0001" },
    );

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("x-codestra-tenant-id")).toBe(tenantId);
    expect(headers.get("x-correlation-id")).toBe("correlation-explicit-0001");
    expect(headers.get("idempotency-key")).toBe(idempotencyKey);
    expect(String(init?.body)).not.toContain("test-token");
  });

  it("rejects credential-bearing or insecure base URLs before requests leave the process", () => {
    expect(() =>
      createCodestraSdk({
        baseUrl: "https://user:pass@api.codestra.co",
        tenantId,
        requestedBy: "moneybee-backend",
        getAccessToken: () => "test-token",
      }),
    ).toThrow(CodestraSdkConfigurationError);

    expect(() =>
      createCodestraSdk({
        baseUrl: "http://api.codestra.co",
        tenantId,
        requestedBy: "moneybee-backend",
        getAccessToken: () => "test-token",
      }),
    ).toThrow(CodestraSdkConfigurationError);
  });
});

function testSdk(fetch: typeof globalThis.fetch) {
  return createCodestraSdk({
    baseUrl: "https://api.codestra.co",
    tenantId,
    requestedBy: "moneybee-backend",
    getAccessToken: () => "test-token",
    fetch,
    commandIdFactory: () => "d0313dba-09f7-4cce-8894-195f72c62126",
    correlationIdFactory: () => correlationId,
    maxRetries: 0,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pathname(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number): string {
  return new URL(String(fetchMock.mock.calls[index]?.[0])).pathname;
}

function headersFor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number): Headers {
  return new Headers(fetchMock.mock.calls[index]?.[1]?.headers);
}

function socialPost() {
  return {
    id: "d0313dba-09f7-4cce-8894-195f72c62126",
    tenantId: "042880db-aa51-4f16-83b5-ae858ee45ad6",
    workspaceId: "204ddc3a-3a33-445f-bfc5-0bb15167b624",
    status: "scheduled",
    channels: [{ channel: "linkedin", status: "scheduled" }],
    content: { text: "Launch update" },
    publishAt: "2026-08-30T18:00:00Z",
    createdAt: "2026-08-30T00:00:00Z",
    updatedAt: "2026-08-30T00:00:00Z",
  };
}
