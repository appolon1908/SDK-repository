import { describe, expect, it } from "vitest";
import {
  InMemoryWebhookProcessingStore,
  InMemoryReplayStore,
  WebhookVerificationError,
  buildWebhookProcessingScope,
  signWebhook,
  verifyAndClaimWebhook,
  verifyAndClaimWebhookProcessing,
  verifyWebhook,
} from "../src/index.js";

const secret = `whsec_${btoa("0123456789abcdef0123456789abcdef")}`;
const nowMilliseconds = 1_800_000_000_000;
const timestamp = Math.floor(nowMilliseconds / 1_000);

describe("webhook verification", () => {
  it("verifies a raw payload and identifies the rotated secret", async () => {
    const payload = JSON.stringify({ id: "post-1" });
    const headers = await signWebhook({ id: "evt_1", timestamp, payload, secret });
    const result = await verifyWebhook({
      id: headers["webhook-id"],
      timestamp: headers["webhook-timestamp"],
      signature: headers["webhook-signature"],
      payload,
      secrets: [`whsec_${btoa("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")}`, secret],
      now: () => nowMilliseconds,
    });
    expect(result.matchedSecretIndex).toBe(1);
  });

  it("rejects payload tampering", async () => {
    const headers = await signWebhook({ id: "evt_2", timestamp, payload: "original", secret });
    await expect(
      verifyWebhook({
        id: headers["webhook-id"],
        timestamp: headers["webhook-timestamp"],
        signature: headers["webhook-signature"],
        payload: "changed",
        secrets: [secret],
        now: () => nowMilliseconds,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("claims an event exactly once", async () => {
    const headers = await signWebhook({ id: "evt_3", timestamp, payload: "payload", secret });
    const store = new InMemoryReplayStore(() => timestamp);
    const input = {
      id: headers["webhook-id"],
      timestamp: headers["webhook-timestamp"],
      signature: headers["webhook-signature"],
      payload: "payload",
      secrets: [secret],
      now: () => nowMilliseconds,
    };
    await verifyAndClaimWebhook(input, store);
    await expect(verifyAndClaimWebhook(input, store)).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("scopes processing claims by tenant, endpoint, signer type, and event ID", async () => {
    const headers = await signWebhook({ id: "evt_4", timestamp, payload: "payload", secret });
    const store = new InMemoryWebhookProcessingStore({
      now: () => timestamp,
      tokenFactory: () => "lease-token-1",
    });

    const claimed = await verifyAndClaimWebhookProcessing(
      {
        id: headers["webhook-id"],
        timestamp: headers["webhook-timestamp"],
        signature: headers["webhook-signature"],
        payload: "payload",
        secrets: [secret],
        now: () => nowMilliseconds,
      },
      store,
      {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        signerType: "current",
        eventId: "evt_4",
        processingTtlSeconds: 30,
        now: () => nowMilliseconds,
      },
    );

    expect(claimed.scope).toBe("tenant-1:endpoint-1:current:evt_4");
    await store.markProcessed(claimed.lease, timestamp + 1);
    await expect(store.get(claimed.scope)).resolves.toMatchObject({
      state: "processed",
      processedAtEpochSeconds: timestamp + 1,
    });
  });

  it("blocks concurrent processing and completed replay for the same scoped event", async () => {
    const headers = await signWebhook({ id: "evt_5", timestamp, payload: "payload", secret });
    const store = new InMemoryWebhookProcessingStore({
      now: () => timestamp,
      tokenFactory: () => "lease-token-2",
    });
    const input = {
      id: headers["webhook-id"],
      timestamp: headers["webhook-timestamp"],
      signature: headers["webhook-signature"],
      payload: "payload",
      secrets: [secret],
      now: () => nowMilliseconds,
    };
    const options = {
      tenantId: "tenant-1",
      endpointId: "endpoint-1",
      signerType: "current" as const,
      eventId: "evt_5",
      processingTtlSeconds: 30,
      now: () => nowMilliseconds,
    };

    const claimed = await verifyAndClaimWebhookProcessing(input, store, options);
    await expect(verifyAndClaimWebhookProcessing(input, store, options)).rejects.toMatchObject({
      code: "PROCESSING_ALREADY_CLAIMED",
    });
    await store.markProcessed(claimed.lease, timestamp + 1);
    await expect(verifyAndClaimWebhookProcessing(input, store, options)).rejects.toMatchObject({
      code: "REPLAY_DETECTED",
    });
  });

  it("allows crash recovery after an expired processing lease", async () => {
    let current = timestamp;
    let token = 0;
    const headers = await signWebhook({ id: "evt_6", timestamp, payload: "payload", secret });
    const store = new InMemoryWebhookProcessingStore({
      now: () => current,
      tokenFactory: () => `lease-token-${token += 1}`,
    });
    const scope = buildWebhookProcessingScope({
      tenantId: "tenant-1",
      endpointId: "endpoint-1",
      signerType: "previous",
      eventId: "evt_6",
    });

    const first = await store.claimProcessing(scope, timestamp + 5);
    expect(first.state).toBe("claimed");
    current = timestamp + 6;
    const second = await store.claimProcessing(scope, timestamp + 36);
    expect(second).toMatchObject({
      state: "claimed",
      lease: { token: "lease-token-2" },
    });
  });

  it("records failed processing outcomes with the active lease", async () => {
    const store = new InMemoryWebhookProcessingStore({ tokenFactory: () => "lease-token-3" });
    const scope = buildWebhookProcessingScope({
      tenantId: "tenant-1",
      endpointId: "endpoint-1",
      signerType: "current",
      eventId: "evt_7",
    });
    const claimed = await store.claimProcessing(scope, timestamp + 30);
    if (claimed.state !== "claimed") throw new Error("expected initial claim");

    await store.markFailed(claimed.lease, timestamp + 2, {
      code: "HANDLER_FAILED",
      message: "Consumer handler rejected the event",
    });

    await expect(store.get(scope)).resolves.toMatchObject({
      state: "failed",
      failedAtEpochSeconds: timestamp + 2,
      failureCode: "HANDLER_FAILED",
    });
  });

  it("rejects processing scopes that do not match the verified webhook event", async () => {
    const headers = await signWebhook({ id: "evt_8", timestamp, payload: "payload", secret });
    const store = new InMemoryWebhookProcessingStore();

    await expect(
      verifyAndClaimWebhookProcessing(
        {
          id: headers["webhook-id"],
          timestamp: headers["webhook-timestamp"],
          signature: headers["webhook-signature"],
          payload: "payload",
          secrets: [secret],
          now: () => nowMilliseconds,
        },
        store,
        {
          tenantId: "tenant-1",
          endpointId: "endpoint-1",
          signerType: "current",
          eventId: "evt_other",
        },
      ),
    ).rejects.toMatchObject({ code: "SCOPE_EVENT_MISMATCH" });
  });
});

describe("atomic webhook failure transitions", () => {
  it.each([
    { code: "", message: "Handler failed" },
    { code: "HANDLER_FAILED", message: "" },
  ])("preserves the lease when failure metadata is invalid: %j", async (failure) => {
    const store = new InMemoryWebhookProcessingStore({ now: () => timestamp });
    const scope = "tenant:endpoint:current:event";
    const claimed = await store.claimProcessing(scope, timestamp + 30);
    if (claimed.state !== "claimed") throw new Error("expected claim");
    const before = await store.get(scope);
    await expect(store.markFailed(claimed.lease, timestamp + 1, failure)).rejects.toBeInstanceOf(WebhookVerificationError);
    expect(await store.get(scope)).toEqual(before);
    await store.markProcessed(claimed.lease, timestamp + 2);
    expect(await store.get(scope)).toMatchObject({ state: "processed" });
  });
});
