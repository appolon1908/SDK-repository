import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createWebhookSecret, signWebhook } from "@codestra/webhook-sdk";
import { acceptSignedInternalEvent, InboundEventError } from "../src/internal-event-boundary.js";
import { CodestraApi } from "../src/credentials/CodestraApi.credentials.js";
import { CodestraInternalTrigger } from "../src/nodes/CodestraInternalTrigger/CodestraInternalTrigger.node.js";
import { claimDurableReplay } from "../src/redis-replay-store.js";

vi.mock("../src/redis-replay-store.js", () => ({ claimDurableReplay: vi.fn(async () => {}) }));
const tenant = "11111111-1111-4111-8111-111111111111";
const otherTenant = "22222222-2222-4222-8222-222222222222";
const secret = createWebhookSecret();
const now = Math.floor(Date.now() / 1000) * 1000;
const credentials = {
  expectedTenantId: tenant, webhookSecrets: secret, allowedSources: "urn:codestra:middleware:events",
  allowedEventTypes: "codestra.social.post.status.v1\ncodestra.webhook.delivery.status.v1",
  replayRedisUrl: "redis://127.0.0.1:6379", timestampToleranceSeconds: 300,
};
function event() {
  return { specversion: "1.0", id: randomUUID(), tenantid: tenant, source: "urn:codestra:middleware:events",
    type: "codestra.social.post.status.v1", time: new Date(now).toISOString(), datacontenttype: "application/json",
    data: { postId: randomUUID(), tenantId: tenant, status: "accepted", deliveries: [], occurredAt: new Date(now).toISOString() } };
}
async function signed(body = event(), text = JSON.stringify(body), signingSecret = secret, timestamp = now / 1000) {
  const rawBody = new TextEncoder().encode(text);
  return { rawBody, headers: await signWebhook({ id: body.id, timestamp, payload: rawBody, secret: signingSecret }),
    credentials, now: () => now, claim: vi.fn(async () => {}) };
}

describe("signed inbound event boundary", () => {
  it("accepts exact signed bytes and claims tenant-scoped replay state after schema validation", async () => {
    const input = await signed();
    const accepted = await acceptSignedInternalEvent(input);
    expect(input.claim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: tenant,
      eventId: accepted.id, retentionSeconds: 86400, bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }));
  });
  it("allows bounded signing-key rotation", async () => {
    const previous = createWebhookSecret();
    const input = await signed(event(), undefined, previous);
    input.credentials = { ...credentials, webhookSecrets: `${secret}\n${previous}` };
    await expect(acceptSignedInternalEvent(input)).resolves.toHaveProperty("tenantid", tenant);
  });
  it.each([-301, 301])("rejects a signature outside the window (%i)", async (offset) => {
    const input = await signed(event(), undefined, secret, now / 1000 + offset);
    await expect(acceptSignedInternalEvent(input)).rejects.toMatchObject({ status: 401 });
    expect(input.claim).not.toHaveBeenCalled();
  });
  it("rejects body changes including whitespace after signing", async () => {
    const input = await signed();
    input.rawBody = new TextEncoder().encode(new TextDecoder().decode(input.rawBody) + " ");
    await expect(acceptSignedInternalEvent(input)).rejects.toMatchObject({ status: 401 });
    expect(input.claim).not.toHaveBeenCalled();
  });
  it("rejects signatures made by another tenant's key", async () => {
    const input = await signed(event(), undefined, createWebhookSecret());
    await expect(acceptSignedInternalEvent(input)).rejects.toMatchObject({ status: 401 });
    expect(input.claim).not.toHaveBeenCalled();
  });
  it.each([
    ["tenant", (e: ReturnType<typeof event>) => { e.tenantid = otherTenant; }, 403],
    ["data tenant", (e: ReturnType<typeof event>) => { e.data.tenantId = otherTenant; }, 403],
    ["source suffix", (e: ReturnType<typeof event>) => { e.source += ":untrusted"; }, 403],
    ["event type", (e: ReturnType<typeof event>) => { e.type = "codestra.unknown.v1"; }, 403],
    ["status", (e: ReturnType<typeof event>) => { e.data.status = "made-up"; }, 422],
    ["date", (e: ReturnType<typeof event>) => { e.time = "2026-02-30T00:00:00Z"; }, 422],
  ] as const)("rejects wrong %s before any replay write", async (_, change, status) => {
    const body = event(); change(body); const input = await signed(body);
    await expect(acceptSignedInternalEvent(input)).rejects.toMatchObject({ status });
    expect(input.claim).not.toHaveBeenCalled();
  });
  it("rejects duplicate JSON keys even with a valid signature", async () => {
    const body = event(); const input = await signed(body, JSON.stringify(body).replace('"specversion":"1.0"', '"specversion":"0.1","specversion":"1.0"'));
    await expect(acceptSignedInternalEvent(input)).rejects.toMatchObject({ code: "INVALID_EVENT_JSON" });
    expect(input.claim).not.toHaveBeenCalled();
  });
  it("requires the signed ID to match the canonical event", async () => {
    const input = await signed(); input.headers = await signWebhook({ id: randomUUID(), payload: input.rawBody, secret, timestamp: now / 1000 });
    await expect(acceptSignedInternalEvent(input)).rejects.toMatchObject({ code: "EVENT_ID_MISMATCH" });
  });
  it("rejects ambiguous signature headers", async () => {
    const input = await signed(); const headers = { ...input.headers, "Webhook-Id": input.headers["webhook-id"] };
    await expect(acceptSignedInternalEvent({ ...input, headers })).rejects.toMatchObject({ code: "INVALID_SIGNATURE_HEADERS" });
  });
  it("bounds payload bytes before verification", async () => {
    const input = await signed();
    await expect(acceptSignedInternalEvent({ ...input, credentials: { ...credentials, maxBodyBytes: 8 } })).rejects.toMatchObject({ status: 413 });
    expect(input.claim).not.toHaveBeenCalled();
  });
  it.each(["redis://remote.invalid:6379", "rediss://user:password@redis.invalid", "https://redis.invalid"])("rejects unsafe replay URL %s", async (replayRedisUrl) => {
    const input = await signed();
    await expect(acceptSignedInternalEvent({ ...input, credentials: { ...credentials, replayRedisUrl } })).rejects.toMatchObject({ code: "INVALID_REPLAY_CONFIGURATION" });
    expect(input.claim).not.toHaveBeenCalled();
  });
  it("does not accept an event when durable replay claiming fails", async () => {
    const input = await signed(); input.claim.mockRejectedValueOnce(new InboundEventError("REPLAY_STORE_UNAVAILABLE", 503));
    await expect(acceptSignedInternalEvent(input)).rejects.toMatchObject({ status: 503 });
  });
  it("requires authenticated credentials for a remote replay store", async () => {
    const input = await signed();
    await expect(acceptSignedInternalEvent({ ...input, credentials: { ...credentials, replayRedisUrl: "rediss://redis.invalid" } })).rejects.toMatchObject({ code: "REPLAY_AUTHENTICATION_REQUIRED" });
    expect(input.claim).not.toHaveBeenCalled();
  });
  it("keeps inbound secrets out of outbound API credentials", () => {
    expect(new CodestraApi().properties.some((property) => /internal|webhook|replay/iu.test(String(property.name)))).toBe(false);
  });
});

describe("n8n request and response integration", () => {
  async function context() {
    const input = await signed(); const json = vi.fn(); const status = vi.fn(() => ({ json }));
    const request: { rawBody?: Uint8Array; rawHeaders?: string[]; readRawBody?: () => Promise<void> } = { rawBody: input.rawBody };
    const ctx = { getRequestObject: () => request, getResponseObject: () => ({ status }),
      getCredentials: vi.fn(async () => credentials), getHeaderData: () => ({ "content-type": "application/json", ...input.headers }),
      getBodyData: vi.fn(() => { throw new Error("Parsed body must never be used"); }),
      helpers: { returnJsonArray: vi.fn((items: Record<string, unknown>[]) => items.map((json) => ({ json }))) } };
    return { ctx, request, status, json };
  }
  it("returns HTTP 202 only after the raw bytes and durable claim pass", async () => {
    const { ctx, status } = await context();
    const result = await new CodestraInternalTrigger().webhook.call(ctx);
    expect(status).toHaveBeenCalledWith(202); expect(result.workflowData?.[0]).toHaveLength(1);
    expect(ctx.getCredentials).toHaveBeenCalledWith("codestraInternalWebhook");
    expect(ctx.getBodyData).not.toHaveBeenCalled(); expect(result.noWebhookResponse).toBe(true);
  });
  it("reads raw bytes through the request API when they are not loaded yet", async () => {
    const { ctx, request, status } = await context(); const body = request.rawBody; delete request.rawBody;
    request.readRawBody = async () => { request.rawBody = body!; };
    await new CodestraInternalTrigger().webhook.call(ctx); expect(status).toHaveBeenCalledWith(202);
  });
  it("returns a real HTTP 400 and no workflow data when raw bytes are unavailable", async () => {
    const { ctx, request, status } = await context(); delete request.rawBody;
    const result = await new CodestraInternalTrigger().webhook.call(ctx);
    expect(status).toHaveBeenCalledWith(400); expect(result.workflowData).toBeUndefined();
  });
  it("rejects duplicate wire headers before execution", async () => {
    const { ctx, request, status } = await context(); request.rawHeaders = ["Webhook-Id", "one", "webhook-id", "two"];
    const result = await new CodestraInternalTrigger().webhook.call(ctx);
    expect(status).toHaveBeenCalledWith(400); expect(result.workflowData).toBeUndefined();
  });
  it("returns HTTP 503 with no workflow or secret details after a storage failure", async () => {
    const { ctx, status, json } = await context(); vi.mocked(claimDurableReplay).mockRejectedValueOnce(new Error("sensitive store details"));
    const result = await new CodestraInternalTrigger().webhook.call(ctx);
    expect(status).toHaveBeenCalledWith(503); expect(result.workflowData).toBeUndefined();
    expect(JSON.stringify(json.mock.calls)).not.toContain("sensitive");
  });
});
