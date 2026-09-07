import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "redis";
import { createWebhookSecret, signWebhook } from "@codestra/webhook-sdk";
import { acceptSignedInternalEvent } from "../src/internal-event-boundary.js";
import { RedisTestServer } from "./support/redis-server.js";

const server = new RedisTestServer();
const volatileServer = new RedisTestServer(false);
beforeAll(async () => { await server.start(); await volatileServer.start(); }, 60_000);
afterAll(async () => { await server.close(); await volatileServer.close(); }, 20_000);
const secret = createWebhookSecret();
async function input(tenant = randomUUID(), id = randomUUID()) {
  const event = { specversion: "1.0", id, tenantid: tenant, source: "urn:codestra:middleware",
    type: "codestra.webhook.delivery.status.v1", time: new Date().toISOString(), datacontenttype: "application/json",
    data: { deliveryId: randomUUID(), endpointId: randomUUID(), status: "delivered", occurredAt: new Date().toISOString() } };
  const rawBody = new TextEncoder().encode(JSON.stringify(event));
  return { rawBody, headers: await signWebhook({ id, payload: rawBody, secret }), credentials: {
    expectedTenantId: tenant, webhookSecrets: secret, allowedSources: event.source, allowedEventTypes: event.type,
    replayRedisUrl: server.url, replayTimeoutMs: 5000 } };
}

describe("durable Redis replay boundary", () => {
  it("accepts exactly one of simultaneous duplicate deliveries", async () => {
    const delivery = await input();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => acceptSignedInternalEvent(delivery)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(11);
    expect(rejected.every((result) => result.status === "rejected" && result.reason.code === "REPLAY_DETECTED")).toBe(true);
  });
  it("retains a confirmed claim across a Redis crash and restart", async () => {
    const delivery = await input(); await acceptSignedInternalEvent(delivery);
    await server.restart();
    delivery.credentials.replayRedisUrl = server.url;
    await expect(acceptSignedInternalEvent(delivery)).rejects.toMatchObject({ code: "REPLAY_DETECTED" });
  });
  it("isolates the same event ID between authenticated tenants", async () => {
    const id = randomUUID();
    await expect(acceptSignedInternalEvent(await input(randomUUID(), id))).resolves.toHaveProperty("id", id);
    await expect(acceptSignedInternalEvent(await input(randomUUID(), id))).resolves.toHaveProperty("id", id);
  });
  it("rejects a store with AOF disabled", async () => {
    const delivery = await input(); delivery.credentials.replayRedisUrl = volatileServer.url;
    await expect(acceptSignedInternalEvent(delivery)).rejects.toMatchObject({ status: 503 });
  });
  it("refuses eviction policies that can discard replay evidence", async () => {
    const client = createClient({ url: server.url }); await client.connect();
    try {
      await client.configSet("maxmemory-policy", "allkeys-lru");
      await expect(acceptSignedInternalEvent(await input())).rejects.toMatchObject({ code: "REPLAY_EVICTION_POLICY_UNSAFE" });
    } finally { await client.configSet("maxmemory-policy", "noeviction"); client.destroy(); }
  });
  it("fails closed when the replay store is unreachable", async () => {
    const delivery = await input(); delivery.credentials.replayRedisUrl = "redis://127.0.0.1:1";
    delivery.credentials.replayTimeoutMs = 200;
    await expect(acceptSignedInternalEvent(delivery)).rejects.toMatchObject({ status: 503 });
  });
});
