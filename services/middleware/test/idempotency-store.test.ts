import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../src/db/prisma.js";
import {
  ConnectorIndeterminateError,
  ConnectorRunner,
  type CodestraConnector,
  type ConnectorCommand,
  type ConnectorCommandResult,
  type ConnectorContext,
} from "@codestra/connector-kit";
import { PrismaIdempotencyStore } from "../src/idempotency/prisma-store.js";

/**
 * Ports packages/connector-kit/test/runner.test.ts's scenarios to run
 * against `PrismaIdempotencyStore` backed by a real Postgres database
 * instead of `InMemoryConnectorIdempotencyStore`, proving the exact same
 * durable state machine holds when it has to survive a real transactional
 * store and concurrent connections instead of a process-local `Map`.
 */

let prisma: PrismaClient;
let tenantId: string;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  prisma = createPrismaClient(process.env.DATABASE_URL!);
  tenantId = randomUUID();
  await prisma.tenant.create({ data: { id: tenantId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

it("requires an explicit database URL instead of using ambient pg connection defaults", () => {
  expect(() => createPrismaClient("")).toThrow("DATABASE_URL is required");
  expect(() => createPrismaClient("   ")).toThrow("DATABASE_URL is required");
});

function connector(options: {
  execute?: CodestraConnector["execute"];
  reconcileCommand?: NonNullable<CodestraConnector["reconcileCommand"]>;
} = {}): CodestraConnector {
  const execute = options.execute ?? vi.fn().mockResolvedValue({ commandId: "placeholder", status: "completed" });
  return {
    manifest: () => ({
      key: "postiz",
      displayName: "Postiz",
      version: "0.1.0",
      operations: [{ name: "social.post.create", mutates: true, requiredCapabilities: ["social.write"] }],
      webhookEventTypes: [],
    }),
    testConnection: vi.fn(),
    execute,
    ingestWebhook: vi.fn(),
    reconcile: vi.fn(),
    ...(options.reconcileCommand === undefined ? {} : { reconcileCommand: options.reconcileCommand }),
  };
}

function freshCommand(): ConnectorCommand {
  return {
    commandId: randomUUID(),
    operation: "social.post.create",
    payload: { text: "Hello" },
    requestedAt: new Date().toISOString(),
    idempotencyKey: `idem-${randomUUID()}`,
  };
}

function freshContext(): ConnectorContext {
  return {
    tenantId,
    correlationId: `correlation-${randomUUID()}`,
    actor: { type: "service", subjectId: "middleware" },
    capabilities: { "social.write": true },
  };
}

describe("PrismaIdempotencyStore durable state machine (real Postgres)", () => {
  it("replays the same completed command without a second provider mutation", async () => {
    const store = new PrismaIdempotencyStore(prisma);
    const runner = new ConnectorRunner({ idempotencyStore: store });
    const command = freshCommand();
    const context = freshContext();
    const adapter = connector({ execute: vi.fn().mockResolvedValue({ commandId: command.commandId, status: "completed" }) });

    const first = await runner.execute(adapter, context, command);
    const second = await runner.execute(adapter, context, command);

    expect(first.replayed).toBeUndefined();
    expect(second.replayed).toBe(true);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of an idempotency key with a different request fingerprint", async () => {
    const store = new PrismaIdempotencyStore(prisma);
    const runner = new ConnectorRunner({ idempotencyStore: store });
    const command = freshCommand();
    const context = freshContext();
    const adapter = connector({ execute: vi.fn().mockResolvedValue({ commandId: command.commandId, status: "completed" }) });

    await runner.execute(adapter, context, command);

    await expect(
      runner.execute(adapter, context, { ...command, payload: { text: "Changed" } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_REQUEST_MISMATCH", retryable: false });
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("retains a timeout after dispatch as indeterminate and blocks blind retry", async () => {
    const store = new PrismaIdempotencyStore(prisma);
    const runner = new ConnectorRunner({ idempotencyStore: store, timeoutMs: 50 });
    const command = freshCommand();
    const context = freshContext();
    const execute = vi.fn<CodestraConnector["execute"]>((executionContext) =>
      new Promise((_, reject) => {
        executionContext.signal?.addEventListener("abort", () => reject(executionContext.signal?.reason), { once: true });
      }),
    );
    const adapter = connector({ execute });

    await expect(runner.execute(adapter, context, command)).rejects.toBeInstanceOf(ConnectorIndeterminateError);
    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({
      code: "IDEMPOTENCY_OUTCOME_INDETERMINATE",
      snapshot: { state: "indeterminate" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retains a network reset after a possible provider acceptance", async () => {
    const store = new PrismaIdempotencyStore(prisma);
    const runner = new ConnectorRunner({ idempotencyStore: store });
    const command = freshCommand();
    const context = freshContext();
    let providerSideEffects = 0;
    const execute = vi.fn<CodestraConnector["execute"]>(async () => {
      providerSideEffects += 1;
      throw new TypeError("socket reset after write");
    });
    const adapter = connector({ execute });

    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({ code: "IDEMPOTENCY_OUTCOME_INDETERMINATE" });
    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({ code: "IDEMPOTENCY_OUTCOME_INDETERMINATE" });
    expect(providerSideEffects).toBe(1);
  });

  it("retains an indeterminate record when result persistence fails after provider success", async () => {
    // A real analogue of connector-kit's FailFirstCompleteStore: force the
    // Postgres UPDATE that would mark the record completed to violate a
    // constraint on its first attempt by racing the lease token, then
    // succeed once retried through the normal reconciliation path.
    const store = new PrismaIdempotencyStore(prisma);
    const command = freshCommand();
    const context = freshContext();
    const scope = `${tenantId}:postiz:${command.operation}:${command.idempotencyKey}`;

    const begin = await store.begin({
      scope,
      requestHash: "a".repeat(64),
      commandId: command.commandId,
      acquiredTtlSeconds: 60,
    });
    if (begin.state !== "acquired") throw new Error("expected acquired lease");
    await store.markDispatched(begin.lease, 300);

    // Simulate "the provider call returned success, but the completion
    // write could not be persisted": complete() with a stale/wrong token
    // fails exactly like a lost race would, and the record must remain
    // "dispatched"/indeterminate rather than silently vanish.
    await expect(
      store.complete({ ...begin.lease, token: "wrong-token" }, { commandId: command.commandId, status: "completed" }, 86_400),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_LEASE_LOST" });

    const snapshot = await store.get(scope);
    expect(snapshot?.state).toBe("dispatched");

    // The real lease can still complete it — proving the record was never
    // corrupted or dropped by the failed attempt.
    await store.complete(begin.lease, { commandId: command.commandId, status: "completed" }, 86_400);
    const completed = await store.get(scope);
    expect(completed?.state).toBe("completed");
  });

  it("reconciles an indeterminate outcome before allowing replay", async () => {
    const store = new PrismaIdempotencyStore(prisma);
    const runner = new ConnectorRunner({ idempotencyStore: store });
    const command = freshCommand();
    const context = freshContext();
    const execute = vi.fn<CodestraConnector["execute"]>().mockRejectedValue(new TypeError("connection lost"));
    const reconcileCommand = vi.fn<NonNullable<CodestraConnector["reconcileCommand"]>>().mockResolvedValue({
      commandId: command.commandId,
      status: "completed",
      providerReference: "provider-123",
    });
    const adapter = connector({ execute, reconcileCommand });

    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({ code: "IDEMPOTENCY_OUTCOME_INDETERMINATE" });
    const reconciled = await runner.reconcileIndeterminate(adapter, context, command);
    const replayed = await runner.execute(adapter, context, command);

    expect(reconciled).toMatchObject({ status: "completed", providerReference: "provider-123" });
    expect(replayed).toMatchObject({ status: "completed", replayed: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reconcileCommand).toHaveBeenCalledTimes(1);
  });

  it("coordinates concurrent duplicate requests across runner instances sharing one atomic Postgres store", async () => {
    const store = new PrismaIdempotencyStore(prisma);
    const command = freshCommand();
    const context = freshContext();

    let releaseProvider: ((result: ConnectorCommandResult) => void) | undefined;
    let providerStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const execute = vi.fn<CodestraConnector["execute"]>(
      () =>
        new Promise<ConnectorCommandResult>((resolve) => {
          releaseProvider = resolve;
          providerStarted?.();
        }),
    );
    const firstRunner = new ConnectorRunner({ idempotencyStore: store });
    const secondRunner = new ConnectorRunner({ idempotencyStore: store });
    const adapter = connector({ execute });

    const first = firstRunner.execute(adapter, context, command);
    await started;
    await expect(secondRunner.execute(adapter, context, command)).rejects.toMatchObject({ code: "IDEMPOTENCY_OUTCOME_INDETERMINATE" });
    releaseProvider?.({ commandId: command.commandId, status: "completed" });
    await expect(first).resolves.toMatchObject({ status: "completed" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not age out dispatched records without explicit reconciliation", async () => {
    const store = new PrismaIdempotencyStore(prisma);
    const command = freshCommand();
    const scope = `${tenantId}:postiz:${command.operation}:${command.idempotencyKey}`;

    const begin = await store.begin({ scope, requestHash: "b".repeat(64), commandId: command.commandId, acquiredTtlSeconds: 1 });
    if (begin.state !== "acquired") throw new Error("expected acquired lease");
    // A short reviewTtl that has already elapsed by the time we check again.
    await store.markDispatched(begin.lease, 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await expect(
      store.begin({ scope, requestHash: "b".repeat(64), commandId: command.commandId, acquiredTtlSeconds: 5 }),
    ).resolves.toMatchObject({ state: "indeterminate" });
  });

  it("recovers correctly across a process restart (new PrismaClient instance)", async () => {
    const firstProcessStore = new PrismaIdempotencyStore(prisma);
    const command = freshCommand();
    const context = freshContext();
    const adapter = connector({ execute: vi.fn().mockResolvedValue({ commandId: command.commandId, status: "completed" }) });
    await new ConnectorRunner({ idempotencyStore: firstProcessStore }).execute(adapter, context, command);

    // A brand-new PrismaClient/store, as a restarted process would create,
    // must see the exact same durable outcome and still replay instead of
    // re-invoking the provider.
    const restartedPrisma = createPrismaClient(process.env.DATABASE_URL!);
    try {
      const secondProcessStore = new PrismaIdempotencyStore(restartedPrisma);
      const replay = await new ConnectorRunner({ idempotencyStore: secondProcessStore }).execute(adapter, context, command);
      expect(replay.replayed).toBe(true);
      expect(adapter.execute).toHaveBeenCalledTimes(1);
    } finally {
      await restartedPrisma.$disconnect();
    }
  });

  it("fails closed when a required capability is disabled before acquiring a lease", async () => {
    const store = new PrismaIdempotencyStore(prisma);
    const runner = new ConnectorRunner({ idempotencyStore: store });
    const command = freshCommand();
    const context = freshContext();
    await expect(
      runner.execute(connector(), { ...context, capabilities: { "social.write": false } }, command),
    ).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
  });
});
