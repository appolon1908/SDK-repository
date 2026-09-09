import { describe, expect, it, vi } from "vitest";
import type { ConnectorContext } from "@codestra/connector-kit";
import { canonicalEvent, KlyrowAdapter, PostizAdapter } from "../src/index.js";

const context: ConnectorContext = {
  tenantId: "2b78b66e-40d9-4dd0-884b-d5cbd3773d04",
  correlationId: "correlation-0001",
  actor: { type: "service", subjectId: "middleware" },
  capabilities: { "social.write": true, "social.external_delivery": true },
};

const command = {
  commandId: "4fab632d-0a69-4d28-8eb1-982bc92cf613",
  operation: "social.post.create",
  payload: { text: "Hello" },
  requestedAt: "2026-08-27T00:00:00Z",
  idempotencyKey: "idempotency-key-0001",
};

describe("provider adapters", () => {
  it("does not perform network activity when the adapter is disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      fetch: fetchMock,
    });
    await expect(adapter.execute(context, command)).rejects.toMatchObject({ code: "CONNECTOR_DISABLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires each provider operation to be explicitly enabled", async () => {
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: [],
      fetch: vi.fn<typeof fetch>(),
    });
    await expect(adapter.execute(context, command)).rejects.toMatchObject({ code: "PROVIDER_OPERATION_DISABLED" });
  });

  it("keeps live email delivery disabled unless email.send is allowlisted", async () => {
    const adapter = new KlyrowAdapter({
      baseUrl: "https://klyrow.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["email.suppression.upsert"],
      fetch: vi.fn<typeof fetch>(),
    });
    await expect(
      adapter.execute(
        { ...context, capabilities: { "email.write": true, "email.live_delivery": true } },
        { ...command, operation: "email.send" },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_OPERATION_DISABLED" });
  });

  it("sends provider commands through the restricted gateway with workload identity", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      commandId: command.commandId,
      status: "accepted",
      providerReference: "postiz-job-1",
    }));
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      workloadIdentity: "middleware-worker-1",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: fetchMock,
    });

    await expect(adapter.execute(context, command)).resolves.toMatchObject({
      commandId: command.commandId,
      status: "accepted",
      providerReference: "postiz-job-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://postiz.internal/internal/v1/codestra/commands"),
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("x-codestra-workload-id")).toBe("middleware-worker-1");
    expect(headers.get("idempotency-key")).toBe(command.idempotencyKey);
    expect(JSON.parse(init.body as string)).toMatchObject({
      commandId: command.commandId,
      operation: "social.post.create",
    });
  });

  it("rejects provider command receipts for a different command", async () => {
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({
        commandId: "2e65f372-7699-465b-8bf7-ec609d152d48",
        status: "accepted",
      })),
    });

    await expect(adapter.execute(context, command)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });

  it("reconciles one command through the command reconciliation route", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      result: {
        commandId: command.commandId,
        status: "completed",
        data: { remoteStatus: "published" },
      },
    }));
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      workloadIdentity: "middleware-worker-1",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: fetchMock,
    });

    await expect(adapter.reconcileCommand(context, command)).resolves.toMatchObject({
      commandId: command.commandId,
      status: "completed",
      data: { remoteStatus: "published" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(`https://postiz.internal/internal/v1/codestra/commands/${command.commandId}/reconciliation`),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns no command reconciliation result while the provider outcome is unknown", async () => {
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({ result: null })),
    });

    await expect(adapter.reconcileCommand(context, command)).resolves.toBeUndefined();
  });

  it("rejects malformed reconciliation items instead of dropping them", async () => {
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({ items: [{ id: "ok" }, null], hasMore: false })),
    });

    await expect(adapter.reconcile(context)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      details: { index: 1 },
    });
  });

  it("retries a retryable failure and succeeds once the gateway recovers", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(errorResponse(503, "UPSTREAM_UNAVAILABLE"))
      .mockResolvedValueOnce(errorResponse(503, "UPSTREAM_UNAVAILABLE"))
      .mockResolvedValueOnce(
        jsonResponse({ commandId: command.commandId, status: "accepted" }),
      );
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: fetchMock,
      sleep: async () => {},
    });

    await expect(adapter.execute(context, command)).resolves.toMatchObject({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable failure", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => errorResponse(400, "INVALID_COMMAND"));
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: fetchMock,
      sleep: async () => {},
    });

    await expect(adapter.execute(context, command)).rejects.toMatchObject({
      code: "INVALID_COMMAND",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up once maxRetries is exhausted", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => errorResponse(503, "UPSTREAM_UNAVAILABLE"));
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: fetchMock,
      maxRetries: 2,
      sleep: async () => {},
    });

    await expect(adapter.execute(context, command)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honors a Retry-After header instead of the default backoff", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, "RATE_LIMITED", { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse({ commandId: command.commandId, status: "accepted" }));
    const sleep = vi.fn(async () => {});
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: fetchMock,
      sleep,
    });

    await expect(adapter.execute(context, command)).resolves.toMatchObject({ status: "accepted" });
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("stops retrying once the request context is aborted mid-backoff", async () => {
    // A real fetch rejects immediately when handed an already-aborted
    // signal, so the mock has to do the same for this test to prove
    // anything about the retry loop's own abort handling.
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      if ((init as RequestInit).signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return errorResponse(503, "UPSTREAM_UNAVAILABLE");
    });
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: fetchMock,
      maxRetries: 5,
      sleep: async () => {
        controller.abort();
      },
    });

    // The first attempt fails normally and schedules a retry; the abort
    // lands during that backoff. The next attempt notices the signal is
    // already aborted and fails fast as non-retryable, so it costs one
    // extra call rather than looping through all 5 configured retries.
    await expect(
      adapter.execute({ ...context, signal: controller.signal }, command),
    ).rejects.toMatchObject({ code: "PROVIDER_REQUEST_ABORTED", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects webhook normalizer output for undeclared event types", async () => {
    const adapter = new PostizAdapter({
      baseUrl: "https://postiz.internal",
      tokenProvider: () => "secret-token",
      enabled: true,
      enabledOperations: ["social.post.create"],
      fetch: vi.fn<typeof fetch>(),
      webhookNormalizer: async () => [
        canonicalEvent({
          id: "ca73ea69-1d46-4fa9-a1c4-f1bd1114bbf5",
          source: "postiz",
          type: "postiz.unknown.v1",
          data: {},
        }),
      ],
    });

    await expect(adapter.ingestWebhook(context, {
      headers: {},
      rawBody: new Uint8Array(),
      receivedAt: "2026-08-27T00:00:00Z",
    })).rejects.toMatchObject({
      code: "UNDECLARED_PROVIDER_EVENT",
      details: { eventType: "postiz.unknown.v1", index: 0 },
    });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function errorResponse(status: number, code: string, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse({ error: { code, message: code } }, { status, headers: extraHeaders });
}
