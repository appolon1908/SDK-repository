import { describe, expect, it, vi } from "vitest";
import type {
  CodestraConnector,
  ConnectorCommand,
  ConnectorCommandResult,
  ConnectorContext,
  ConnectorIdempotencyBeginInput,
  ConnectorIdempotencyLease,
  ConnectorIdempotencySnapshot,
  ConnectorIdempotencyStore,
  ConnectorIndeterminateOutcome,
  IdempotencyBeginResult,
  ResolveIndeterminateInput,
} from "../src/index.js";
import {
  ConnectorIndeterminateError,
  ConnectorPolicyError,
  ConnectorRunner,
  InMemoryConnectorIdempotencyStore,
  computeConnectorCommandRequestHash,
} from "../src/index.js";

const context: ConnectorContext = {
  tenantId: "c3f2057a-7631-4906-8dfd-99b9e159978b",
  correlationId: "correlation-0001",
  actor: { type: "service", subjectId: "middleware" },
  capabilities: { "social.write": true },
};

const command: ConnectorCommand = {
  commandId: "cmd-000000000001",
  operation: "social.post.create",
  payload: { text: "Hello" },
  requestedAt: "2026-08-27T00:00:00Z",
  idempotencyKey: "idempotency-key-0001",
};

function connector(options: {
  execute?: CodestraConnector["execute"];
  reconcileCommand?: NonNullable<CodestraConnector["reconcileCommand"]>;
} = {}): CodestraConnector {
  const execute = options.execute ?? vi.fn().mockResolvedValue({
    commandId: command.commandId,
    status: "completed",
  });
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

class FailFirstCompleteStore implements ConnectorIdempotencyStore {
  private failed = false;

  constructor(private readonly delegate: ConnectorIdempotencyStore) {}

  begin(input: ConnectorIdempotencyBeginInput): Promise<IdempotencyBeginResult> {
    return this.delegate.begin(input);
  }

  markDispatched(lease: ConnectorIdempotencyLease, ttl: number): Promise<void> {
    return this.delegate.markDispatched(lease, ttl);
  }

  async complete(lease: ConnectorIdempotencyLease, result: ConnectorCommandResult, ttl: number): Promise<void> {
    if (!this.failed) {
      this.failed = true;
      throw new Error("database unavailable after provider response");
    }
    await this.delegate.complete(lease, result, ttl);
  }

  markIndeterminate(
    lease: ConnectorIdempotencyLease,
    outcome: ConnectorIndeterminateOutcome,
    ttl: number,
  ): Promise<void> {
    return this.delegate.markIndeterminate(lease, outcome, ttl);
  }

  releaseBeforeDispatch(lease: ConnectorIdempotencyLease): Promise<void> {
    return this.delegate.releaseBeforeDispatch(lease);
  }

  resolveIndeterminate(input: ResolveIndeterminateInput): Promise<void> {
    return this.delegate.resolveIndeterminate(input);
  }

  get(scope: string): Promise<ConnectorIdempotencySnapshot | undefined> {
    return this.delegate.get(scope);
  }
}

describe("ConnectorRunner durable idempotency", () => {
  it("replays the same completed command without a second provider mutation", async () => {
    const adapter = connector();
    const runner = new ConnectorRunner({ idempotencyStore: new InMemoryConnectorIdempotencyStore() });

    const first = await runner.execute(adapter, context, command);
    const second = await runner.execute(adapter, context, command);

    expect(first.replayed).toBeUndefined();
    expect(second.replayed).toBe(true);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of an idempotency key with a different request fingerprint", async () => {
    const adapter = connector();
    const runner = new ConnectorRunner({ idempotencyStore: new InMemoryConnectorIdempotencyStore() });
    await runner.execute(adapter, context, command);

    await expect(
      runner.execute(adapter, context, { ...command, payload: { text: "Changed" } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_REQUEST_MISMATCH", retryable: false });
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("retains a timeout after dispatch as indeterminate and blocks blind retry", async () => {
    const execute = vi.fn<CodestraConnector["execute"]>((executionContext) =>
      new Promise((_, reject) => {
        executionContext.signal?.addEventListener(
          "abort",
          () => reject(executionContext.signal?.reason),
          { once: true },
        );
      }),
    );
    const adapter = connector({ execute });
    const runner = new ConnectorRunner({
      idempotencyStore: new InMemoryConnectorIdempotencyStore(),
      timeoutMs: 5,
    });

    await expect(runner.execute(adapter, context, command)).rejects.toBeInstanceOf(ConnectorIndeterminateError);
    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({
      code: "IDEMPOTENCY_OUTCOME_INDETERMINATE",
      snapshot: { state: "indeterminate" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retains a network reset after a possible provider acceptance", async () => {
    let providerSideEffects = 0;
    const execute = vi.fn<CodestraConnector["execute"]>(async () => {
      providerSideEffects += 1;
      throw new TypeError("socket reset after write");
    });
    const adapter = connector({ execute });
    const runner = new ConnectorRunner({ idempotencyStore: new InMemoryConnectorIdempotencyStore() });

    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({
      code: "IDEMPOTENCY_OUTCOME_INDETERMINATE",
    });
    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({
      code: "IDEMPOTENCY_OUTCOME_INDETERMINATE",
    });
    expect(providerSideEffects).toBe(1);
  });

  it("retains an indeterminate record when result persistence fails after provider success", async () => {
    const execute = vi.fn<CodestraConnector["execute"]>().mockResolvedValue({
      commandId: command.commandId,
      status: "completed",
    });
    const adapter = connector({ execute });
    const store = new FailFirstCompleteStore(new InMemoryConnectorIdempotencyStore());
    const runner = new ConnectorRunner({ idempotencyStore: store });

    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({
      code: "IDEMPOTENCY_OUTCOME_INDETERMINATE",
      snapshot: { state: "indeterminate" },
    });
    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({
      code: "IDEMPOTENCY_OUTCOME_INDETERMINATE",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reconciles an indeterminate outcome before allowing replay", async () => {
    const execute = vi.fn<CodestraConnector["execute"]>().mockRejectedValue(new TypeError("connection lost"));
    const reconcileCommand = vi.fn<NonNullable<CodestraConnector["reconcileCommand"]>>().mockResolvedValue({
      commandId: command.commandId,
      status: "completed",
      providerReference: "provider-123",
    });
    const adapter = connector({ execute, reconcileCommand });
    const runner = new ConnectorRunner({ idempotencyStore: new InMemoryConnectorIdempotencyStore() });

    await expect(runner.execute(adapter, context, command)).rejects.toMatchObject({
      code: "IDEMPOTENCY_OUTCOME_INDETERMINATE",
    });
    const reconciled = await runner.reconcileIndeterminate(adapter, context, command);
    const replayed = await runner.execute(adapter, context, command);

    expect(reconciled).toMatchObject({ status: "completed", providerReference: "provider-123" });
    expect(replayed).toMatchObject({ status: "completed", replayed: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reconcileCommand).toHaveBeenCalledTimes(1);
  });

  it("coordinates concurrent duplicate requests across runner instances sharing one atomic store", async () => {
    let releaseProvider: ((result: ConnectorCommandResult) => void) | undefined;
    let providerStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const execute = vi.fn<CodestraConnector["execute"]>(() =>
      new Promise<ConnectorCommandResult>((resolve) => {
        releaseProvider = resolve;
        providerStarted?.();
      }),
    );
    const store = new InMemoryConnectorIdempotencyStore();
    const firstRunner = new ConnectorRunner({ idempotencyStore: store });
    const secondRunner = new ConnectorRunner({ idempotencyStore: store });
    const adapter = connector({ execute });

    const first = firstRunner.execute(adapter, context, command);
    await started;
    await expect(secondRunner.execute(adapter, context, command)).rejects.toMatchObject({
      code: "IDEMPOTENCY_OUTCOME_INDETERMINATE",
    });
    releaseProvider?.({ commandId: command.commandId, status: "completed" });
    await expect(first).resolves.toMatchObject({ status: "completed" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not age out dispatched records without explicit reconciliation", async () => {
    let now = 1_800_000_000;
    const store = new InMemoryConnectorIdempotencyStore({
      now: () => now,
      tokenFactory: () => "lease-token-0001",
    });
    const requestHash = await computeConnectorCommandRequestHash(context, "postiz", command);
    const scope = `${context.tenantId}:postiz:${command.operation}:${command.idempotencyKey}`;
    const begin = await store.begin({
      scope,
      requestHash,
      commandId: command.commandId,
      acquiredTtlSeconds: 5,
    });
    if (begin.state !== "acquired") throw new Error("expected acquired lease");
    await store.markDispatched(begin.lease, 5);
    now += 60;

    await expect(store.begin({
      scope,
      requestHash,
      commandId: command.commandId,
      acquiredTtlSeconds: 5,
    })).resolves.toMatchObject({ state: "indeterminate" });
  });

  it("fails closed when a required capability is disabled before acquiring a lease", async () => {
    const store = new InMemoryConnectorIdempotencyStore();
    const runner = new ConnectorRunner({ idempotencyStore: store });
    await expect(
      runner.execute(connector(), { ...context, capabilities: { "social.write": false } }, command),
    ).rejects.toBeInstanceOf(ConnectorPolicyError);
  });
});

describe("atomic idempotency transitions", () => {
  it.each(["dispatch", "complete", "indeterminate"] as const)("preserves state and lease after an invalid %s TTL", async (transition) => {
    const store = new InMemoryConnectorIdempotencyStore({ now: () => 1_800_000_000 });
    const scope = "atomic-transition";
    const begin = await store.begin({ scope, requestHash: "a".repeat(64), commandId: command.commandId, acquiredTtlSeconds: 30 });
    if (begin.state !== "acquired") throw new Error("expected lease");
    if (transition !== "dispatch") await store.markDispatched(begin.lease, 30);
    const before = await store.get(scope);
    const result: ConnectorCommandResult = { commandId: command.commandId, status: "completed" };
    const outcome: ConnectorIndeterminateOutcome = { code: "UNKNOWN", message: "Connection lost", occurredAt: command.requestedAt, retryable: false };
    const apply = (ttl: number) => transition === "dispatch" ? store.markDispatched(begin.lease, ttl)
      : transition === "complete" ? store.complete(begin.lease, result, ttl)
      : store.markIndeterminate(begin.lease, outcome, ttl);
    await expect(apply(0)).rejects.toThrow();
    expect(await store.get(scope)).toEqual(before);
    await expect(apply(30)).resolves.toBeUndefined();
  });

  it.each(["complete", "reconcile"] as const)("preserves recoverable state if %s cannot clone its result", async (transition) => {
    const store = new InMemoryConnectorIdempotencyStore({ now: () => 1_800_000_000 });
    const scope = "atomic-clone";
    const requestHash = "a".repeat(64);
    const begin = await store.begin({ scope, requestHash, commandId: command.commandId, acquiredTtlSeconds: 30 });
    if (begin.state !== "acquired") throw new Error("expected lease");
    await store.markDispatched(begin.lease, 30);
    const before = await store.get(scope);
    const result = { commandId: command.commandId, status: "completed", data: { invalid: () => undefined } } as unknown as ConnectorCommandResult;
    await expect(transition === "complete" ? store.complete(begin.lease, result, 30)
      : store.resolveIndeterminate({ scope, requestHash, result, completedTtlSeconds: 30 })).rejects.toThrow();
    expect(await store.get(scope)).toEqual(before);
    await expect(store.complete(begin.lease, { commandId: command.commandId, status: "completed" }, 30)).resolves.toBeUndefined();
  });
});
