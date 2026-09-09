import type { ISODateTime, JsonObject, JsonValue, UUID } from "@codestra/contracts";

export type ConnectorHealthStatus = "healthy" | "degraded" | "unavailable" | "disabled";
export type ConnectorCommandStatus = "accepted" | "completed" | "rejected";

export interface ConnectorOperation {
  name: string;
  mutates: boolean;
  requiredCapabilities: readonly string[];
  description?: string;
}

export interface ConnectorManifest {
  key: string;
  displayName: string;
  version: string;
  operations: readonly ConnectorOperation[];
  webhookEventTypes: readonly string[];
}

export interface ConnectorActor {
  type: "user" | "service" | "operator";
  subjectId: string;
}

export interface ConnectorContext {
  tenantId: UUID;
  correlationId: string;
  actor: ConnectorActor;
  capabilities: Readonly<Record<string, boolean>>;
  signal?: AbortSignal;
}

export interface ConnectorCommand {
  commandId: UUID;
  operation: string;
  payload: JsonObject;
  requestedAt: ISODateTime;
  idempotencyKey?: string;
  expectedVersion?: number;
}

export interface ConnectorCommandResult {
  commandId: UUID;
  status: ConnectorCommandStatus;
  providerReference?: string;
  data?: JsonObject;
  replayed?: boolean;
}

export interface ConnectorHealth {
  status: ConnectorHealthStatus;
  checkedAt: ISODateTime;
  latencyMs?: number;
  details?: JsonObject;
}

export interface ConnectorWebhookInput {
  headers: Readonly<Record<string, string>>;
  rawBody: Uint8Array;
  receivedAt: ISODateTime;
}

export interface NormalizedConnectorEvent {
  id: UUID;
  source: string;
  type: string;
  subject?: string;
  time: ISODateTime;
  data: JsonObject;
}

export interface ReconciliationResult {
  items: readonly JsonObject[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface CodestraConnector {
  manifest(): ConnectorManifest;
  testConnection(context: ConnectorContext): Promise<ConnectorHealth>;
  execute(context: ConnectorContext, command: ConnectorCommand): Promise<ConnectorCommandResult>;
  ingestWebhook(
    context: ConnectorContext,
    input: ConnectorWebhookInput,
  ): Promise<readonly NormalizedConnectorEvent[]>;
  reconcile(context: ConnectorContext, cursor?: string): Promise<ReconciliationResult>;
  /**
   * Reconcile one previously dispatched command without issuing the mutation again.
   * Returning undefined means the provider outcome is still unknown or pending.
   */
  reconcileCommand?(
    context: ConnectorContext,
    command: ConnectorCommand,
  ): Promise<ConnectorCommandResult | undefined>;
}

export class ConnectorError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: JsonObject | undefined;

  constructor(
    message: string,
    code: string,
    options: { retryable?: boolean; details?: JsonObject; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export class ConnectorPolicyError extends ConnectorError {
  constructor(message: string, code = "CONNECTOR_POLICY_DENIED", details?: JsonObject) {
    super(message, code, details === undefined ? {} : { details });
  }
}

export class ConnectorConflictError extends ConnectorError {
  constructor(
    message: string,
    code = "CONNECTOR_CONFLICT",
    options: { retryable?: boolean; details?: JsonObject; cause?: unknown } = {},
  ) {
    super(message, code, {
      retryable: options.retryable ?? true,
      ...(options.details === undefined ? {} : { details: options.details }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
  }
}

export class ConnectorTimeoutError extends ConnectorError {
  constructor(timeoutMs: number) {
    super(`Connector execution exceeded ${timeoutMs}ms.`, "CONNECTOR_TIMEOUT", { retryable: true });
  }
}

export type ConnectorIdempotencyRecordState =
  | "acquired"
  | "dispatched"
  | "indeterminate"
  | "completed";

export interface ConnectorIndeterminateOutcome {
  code: string;
  message: string;
  occurredAt: ISODateTime;
  retryable: boolean;
}

export interface ConnectorIdempotencySnapshot {
  scope: string;
  requestHash: string;
  commandId: UUID;
  state: ConnectorIdempotencyRecordState;
  expiresAtEpochSeconds: number;
  result?: ConnectorCommandResult;
  outcome?: ConnectorIndeterminateOutcome;
}

export interface ConnectorIdempotencyLease {
  scope: string;
  requestHash: string;
  commandId: UUID;
  token: string;
}

export interface ConnectorIdempotencyBeginInput {
  scope: string;
  requestHash: string;
  commandId: UUID;
  acquiredTtlSeconds: number;
}

export type IdempotencyBeginResult =
  | { state: "acquired"; lease: ConnectorIdempotencyLease }
  | { state: "in_progress"; snapshot: ConnectorIdempotencySnapshot }
  | { state: "indeterminate"; snapshot: ConnectorIdempotencySnapshot }
  | { state: "completed"; snapshot: ConnectorIdempotencySnapshot; result: ConnectorCommandResult }
  | { state: "request_mismatch"; snapshot: ConnectorIdempotencySnapshot };

export interface ResolveIndeterminateInput {
  scope: string;
  requestHash: string;
  result: ConnectorCommandResult;
  completedTtlSeconds: number;
}

/**
 * Production implementations must make each transition atomic and compare the
 * lease token and request hash in the same transaction or script.
 */
export interface ConnectorIdempotencyStore {
  begin(input: ConnectorIdempotencyBeginInput): Promise<IdempotencyBeginResult>;
  markDispatched(lease: ConnectorIdempotencyLease, reviewTtlSeconds: number): Promise<void>;
  complete(
    lease: ConnectorIdempotencyLease,
    result: ConnectorCommandResult,
    completedTtlSeconds: number,
  ): Promise<void>;
  markIndeterminate(
    lease: ConnectorIdempotencyLease,
    outcome: ConnectorIndeterminateOutcome,
    reviewTtlSeconds: number,
  ): Promise<void>;
  releaseBeforeDispatch(lease: ConnectorIdempotencyLease): Promise<void>;
  resolveIndeterminate(input: ResolveIndeterminateInput): Promise<void>;
  get(scope: string): Promise<ConnectorIdempotencySnapshot | undefined>;
}

interface IdempotencyRecord extends ConnectorIdempotencySnapshot {
  token?: string;
}

export interface InMemoryConnectorIdempotencyStoreOptions {
  now?: () => number;
  tokenFactory?: () => string;
}

/**
 * Local-development and test implementation only. It models the same atomic
 * state transitions but is not durable and cannot coordinate separate hosts.
 */
export class InMemoryConnectorIdempotencyStore implements ConnectorIdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly now: () => number;
  private readonly tokenFactory: () => string;

  constructor(options: InMemoryConnectorIdempotencyStoreOptions | (() => number) = {}) {
    const normalized = typeof options === "function" ? { now: options } : options;
    this.now = normalized.now ?? (() => Math.floor(Date.now() / 1_000));
    this.tokenFactory =
      normalized.tokenFactory ??
      (() => {
        if (!globalThis.crypto?.randomUUID) {
          throw new ConnectorError(
            "A cryptographically secure randomUUID implementation is required.",
            "CRYPTO_UNAVAILABLE",
          );
        }
        return globalThis.crypto.randomUUID();
      });
  }

  async begin(input: ConnectorIdempotencyBeginInput): Promise<IdempotencyBeginResult> {
    validateIdempotencyBeginInput(input);
    this.cleanup();
    const existing = this.records.get(input.scope);

    if (existing) {
      const snapshot = toSnapshot(existing);
      if (existing.requestHash !== input.requestHash || existing.commandId !== input.commandId) {
        return { state: "request_mismatch", snapshot };
      }
      if (existing.state === "completed" && existing.result !== undefined) {
        return { state: "completed", snapshot, result: structuredClone(existing.result) };
      }
      if (existing.state === "acquired") return { state: "in_progress", snapshot };
      return { state: "indeterminate", snapshot };
    }

    const token = requireSingleLine(this.tokenFactory(), "lease token");
    const record: IdempotencyRecord = {
      scope: input.scope,
      requestHash: input.requestHash,
      commandId: input.commandId,
      state: "acquired",
      expiresAtEpochSeconds: this.now() + input.acquiredTtlSeconds,
      token,
    };
    this.records.set(input.scope, record);
    return {
      state: "acquired",
      lease: {
        scope: input.scope,
        requestHash: input.requestHash,
        commandId: input.commandId,
        token,
      },
    };
  }

  async markDispatched(lease: ConnectorIdempotencyLease, reviewTtlSeconds: number): Promise<void> {
    const record = this.requireLease(lease, ["acquired"]);
    const expiresAtEpochSeconds = this.now() + positiveInteger(reviewTtlSeconds, "reviewTtlSeconds");
    record.state = "dispatched";
    record.expiresAtEpochSeconds = expiresAtEpochSeconds;
  }

  async complete(
    lease: ConnectorIdempotencyLease,
    result: ConnectorCommandResult,
    completedTtlSeconds: number,
  ): Promise<void> {
    const record = this.requireLease(lease, ["dispatched", "indeterminate"]);
    const expiresAtEpochSeconds = this.now() + positiveInteger(completedTtlSeconds, "completedTtlSeconds");
    const storedResult = structuredClone(result);
    record.state = "completed";
    record.result = storedResult;
    delete record.outcome;
    delete record.token;
    record.expiresAtEpochSeconds = expiresAtEpochSeconds;
  }

  async markIndeterminate(
    lease: ConnectorIdempotencyLease,
    outcome: ConnectorIndeterminateOutcome,
    reviewTtlSeconds: number,
  ): Promise<void> {
    const record = this.requireLease(lease, ["dispatched", "indeterminate"]);
    const expiresAtEpochSeconds = this.now() + positiveInteger(reviewTtlSeconds, "reviewTtlSeconds");
    const storedOutcome = structuredClone(outcome);
    record.state = "indeterminate";
    record.outcome = storedOutcome;
    record.expiresAtEpochSeconds = expiresAtEpochSeconds;
  }

  async releaseBeforeDispatch(lease: ConnectorIdempotencyLease): Promise<void> {
    const record = this.records.get(lease.scope);
    if (!record) return;
    if (
      record.state === "acquired" &&
      record.token === lease.token &&
      record.requestHash === lease.requestHash &&
      record.commandId === lease.commandId
    ) {
      this.records.delete(lease.scope);
    }
  }

  async resolveIndeterminate(input: ResolveIndeterminateInput): Promise<void> {
    positiveInteger(input.completedTtlSeconds, "completedTtlSeconds");
    const record = this.records.get(input.scope);
    if (!record) {
      throw new ConnectorConflictError(
        "No idempotency record exists for reconciliation.",
        "IDEMPOTENCY_RECORD_NOT_FOUND",
        { retryable: false, details: { scope: input.scope } },
      );
    }
    if (record.requestHash !== input.requestHash) {
      throw requestMismatchError(record);
    }
    if (record.state !== "dispatched" && record.state !== "indeterminate") {
      throw new ConnectorConflictError(
        `Idempotency record cannot be reconciled from state ${record.state}.`,
        "IDEMPOTENCY_STATE_CONFLICT",
        { retryable: false, details: { scope: input.scope, state: record.state } },
      );
    }
    const expiresAtEpochSeconds = this.now() + input.completedTtlSeconds;
    const storedResult = structuredClone(input.result);
    record.state = "completed";
    record.result = storedResult;
    delete record.outcome;
    delete record.token;
    record.expiresAtEpochSeconds = expiresAtEpochSeconds;
  }

  async get(scope: string): Promise<ConnectorIdempotencySnapshot | undefined> {
    this.cleanup();
    const record = this.records.get(requireSingleLine(scope, "scope"));
    return record ? toSnapshot(record) : undefined;
  }

  private requireLease(
    lease: ConnectorIdempotencyLease,
    allowedStates: readonly ConnectorIdempotencyRecordState[],
  ): IdempotencyRecord {
    validateLease(lease);
    const record = this.records.get(lease.scope);
    if (
      !record ||
      record.token !== lease.token ||
      record.requestHash !== lease.requestHash ||
      record.commandId !== lease.commandId ||
      !allowedStates.includes(record.state)
    ) {
      throw new ConnectorConflictError(
        "The idempotency lease was lost or is no longer in the expected state.",
        "IDEMPOTENCY_LEASE_LOST",
        { retryable: false, details: { scope: lease.scope } },
      );
    }
    return record;
  }

  private cleanup(): void {
    const current = this.now();
    for (const [key, record] of this.records) {
      // Never delete a dispatched or indeterminate record merely because its
      // review deadline passed. It must be reconciled explicitly.
      if (
        record.expiresAtEpochSeconds <= current &&
        (record.state === "acquired" || record.state === "completed")
      ) {
        this.records.delete(key);
      }
    }
  }
}

export class ConnectorIndeterminateError extends ConnectorError {
  readonly snapshot: ConnectorIdempotencySnapshot;

  constructor(snapshot: ConnectorIdempotencySnapshot, cause?: unknown) {
    super(
      "The connector command may have reached the provider. Reconcile the recorded outcome before retrying.",
      "IDEMPOTENCY_OUTCOME_INDETERMINATE",
      {
        retryable: false,
        details: {
          scope: snapshot.scope,
          requestHash: snapshot.requestHash,
          commandId: snapshot.commandId,
          state: snapshot.state,
        },
        ...(cause === undefined ? {} : { cause }),
      },
    );
    this.snapshot = structuredClone(snapshot);
  }
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetAfterMs?: number;
  now?: () => number;
}

interface CircuitState {
  failures: number;
  openedAt?: number;
  probeInFlight: boolean;
}

export class ConnectorCircuitBreaker {
  private readonly states = new Map<string, CircuitState>();
  private readonly failureThreshold: number;
  private readonly resetAfterMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = positiveInteger(options.failureThreshold ?? 5, "failureThreshold");
    this.resetAfterMs = positiveInteger(options.resetAfterMs ?? 30_000, "resetAfterMs");
    this.now = options.now ?? Date.now;
  }

  beforeRequest(scope: string): void {
    const state = this.states.get(scope);
    if (!state?.openedAt) return;
    if (this.now() - state.openedAt < this.resetAfterMs) {
      throw new ConnectorError("Connector circuit is open.", "CONNECTOR_CIRCUIT_OPEN", { retryable: true });
    }
    if (state.probeInFlight) {
      throw new ConnectorError("Connector recovery probe is already in progress.", "CONNECTOR_CIRCUIT_PROBE_BUSY", {
        retryable: true,
      });
    }
    state.probeInFlight = true;
  }

  recordSuccess(scope: string): void {
    this.states.delete(scope);
  }

  recordFailure(scope: string): void {
    const state = this.states.get(scope) ?? { failures: 0, probeInFlight: false };
    state.failures += 1;
    state.probeInFlight = false;
    if (state.failures >= this.failureThreshold) state.openedAt = this.now();
    this.states.set(scope, state);
  }
}

export interface ConnectorRunnerOptions {
  idempotencyStore: ConnectorIdempotencyStore;
  circuitBreaker?: ConnectorCircuitBreaker;
  timeoutMs?: number;
  /** @deprecated Use acquiredTtlSeconds. */
  inProgressTtlSeconds?: number;
  acquiredTtlSeconds?: number;
  indeterminateReviewTtlSeconds?: number;
  completedTtlSeconds?: number;
  now?: () => Date;
}

export class ConnectorRunner {
  private readonly idempotencyStore: ConnectorIdempotencyStore;
  private readonly circuitBreaker: ConnectorCircuitBreaker;
  private readonly timeoutMs: number;
  private readonly acquiredTtlSeconds: number;
  private readonly indeterminateReviewTtlSeconds: number;
  private readonly completedTtlSeconds: number;
  private readonly now: () => Date;

  constructor(options: ConnectorRunnerOptions) {
    this.idempotencyStore = options.idempotencyStore;
    this.circuitBreaker = options.circuitBreaker ?? new ConnectorCircuitBreaker();
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 15_000, "timeoutMs");
    this.acquiredTtlSeconds = positiveInteger(
      options.acquiredTtlSeconds ?? options.inProgressTtlSeconds ?? 60,
      "acquiredTtlSeconds",
    );
    this.indeterminateReviewTtlSeconds = positiveInteger(
      options.indeterminateReviewTtlSeconds ?? 604_800,
      "indeterminateReviewTtlSeconds",
    );
    this.completedTtlSeconds = positiveInteger(options.completedTtlSeconds ?? 86_400, "completedTtlSeconds");
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    connector: CodestraConnector,
    context: ConnectorContext,
    command: ConnectorCommand,
  ): Promise<ConnectorCommandResult> {
    validateContext(context);
    validateCommand(command);
    const manifest = validateManifest(connector.manifest());
    const operation = requireOperation(manifest, command.operation);
    requireCapabilities(operation, context);

    if (!operation.mutates) {
      return this.executeReadOnly(connector, manifest, context, command);
    }

    const idempotencyKey = validateIdempotencyKey(command.idempotencyKey);
    const scope = buildIdempotencyScope(context.tenantId, manifest.key, command.operation, idempotencyKey);
    const requestHash = await computeConnectorCommandRequestHash(context, manifest.key, command);
    const begin = await this.idempotencyStore.begin({
      scope,
      requestHash,
      commandId: command.commandId,
      acquiredTtlSeconds: this.acquiredTtlSeconds,
    });

    if (begin.state === "completed") return { ...begin.result, replayed: true };
    if (begin.state === "request_mismatch") throw requestMismatchError(begin.snapshot);
    if (begin.state === "in_progress") {
      throw new ConnectorConflictError(
        "An identical connector command is already being prepared.",
        "IDEMPOTENCY_IN_PROGRESS",
        { details: { scope, requestHash, state: begin.snapshot.state } },
      );
    }
    if (begin.state === "indeterminate") {
      throw new ConnectorIndeterminateError(begin.snapshot);
    }

    const lease = begin.lease;
    const circuitScope = `${context.tenantId}:${manifest.key}`;

    try {
      if (context.signal?.aborted) throw abortBeforeDispatchError(context.signal.reason);
      this.circuitBreaker.beforeRequest(circuitScope);
    } catch (error) {
      await this.releaseBeforeDispatchOrThrow(lease, error);
      throw error;
    }

    try {
      await this.idempotencyStore.markDispatched(
        lease,
        this.indeterminateReviewTtlSeconds,
      );
    } catch (error) {
      await this.releaseBeforeDispatchOrThrow(lease, error);
      throw new ConnectorError(
        "The dispatched state could not be persisted, so the provider was not called.",
        "IDEMPOTENCY_DISPATCH_PERSISTENCE_FAILED",
        { retryable: true, cause: error },
      );
    }

    const timeout = createExecutionTimeout(context.signal, this.timeoutMs);
    let result: ConnectorCommandResult;
    try {
      const executionContext: ConnectorContext = { ...context, signal: timeout.signal };
      result = await Promise.race([
        connector.execute(executionContext, command),
        timeout.rejection,
      ]);
      validateConnectorResult(command, result);
    } catch (error) {
      this.circuitBreaker.recordFailure(circuitScope);
      const snapshot = await this.retainIndeterminate(lease, error);
      throw new ConnectorIndeterminateError(snapshot, error);
    } finally {
      timeout.cleanup();
    }

    this.circuitBreaker.recordSuccess(circuitScope);
    try {
      await this.idempotencyStore.complete(lease, result, this.completedTtlSeconds);
    } catch (error) {
      const snapshot = await this.retainIndeterminate(
        lease,
        new ConnectorError(
          "The provider returned a result but the idempotency completion record could not be persisted.",
          "IDEMPOTENCY_COMPLETION_PERSISTENCE_FAILED",
          { retryable: false, cause: error },
        ),
      );
      throw new ConnectorIndeterminateError(snapshot, error);
    }

    return result;
  }

  async getIdempotencyStatus(
    connector: CodestraConnector,
    context: ConnectorContext,
    command: ConnectorCommand,
  ): Promise<ConnectorIdempotencySnapshot | undefined> {
    validateContext(context);
    validateCommand(command);
    const manifest = validateManifest(connector.manifest());
    const operation = requireOperation(manifest, command.operation);
    if (!operation.mutates) return undefined;
    const key = validateIdempotencyKey(command.idempotencyKey);
    const scope = buildIdempotencyScope(context.tenantId, manifest.key, command.operation, key);
    const requestHash = await computeConnectorCommandRequestHash(context, manifest.key, command);
    const snapshot = await this.idempotencyStore.get(scope);
    if (snapshot && (snapshot.requestHash !== requestHash || snapshot.commandId !== command.commandId)) {
      throw requestMismatchError(snapshot);
    }
    return snapshot;
  }

  async reconcileIndeterminate(
    connector: CodestraConnector,
    context: ConnectorContext,
    command: ConnectorCommand,
  ): Promise<ConnectorCommandResult | undefined> {
    validateContext(context);
    validateCommand(command);
    const manifest = validateManifest(connector.manifest());
    const operation = requireOperation(manifest, command.operation);
    requireCapabilities(operation, context);
    if (!operation.mutates) {
      throw new ConnectorPolicyError(
        "Only mutating connector commands have an idempotency outcome to reconcile.",
        "RECONCILIATION_NOT_REQUIRED",
      );
    }

    const key = validateIdempotencyKey(command.idempotencyKey);
    const scope = buildIdempotencyScope(context.tenantId, manifest.key, command.operation, key);
    const requestHash = await computeConnectorCommandRequestHash(context, manifest.key, command);
    const snapshot = await this.idempotencyStore.get(scope);
    if (!snapshot) {
      throw new ConnectorConflictError(
        "No idempotency record exists for this connector command.",
        "IDEMPOTENCY_RECORD_NOT_FOUND",
        { retryable: false, details: { scope } },
      );
    }
    if (snapshot.requestHash !== requestHash || snapshot.commandId !== command.commandId) {
      throw requestMismatchError(snapshot);
    }
    if (snapshot.state === "completed" && snapshot.result !== undefined) {
      return { ...snapshot.result, replayed: true };
    }
    if (snapshot.state === "acquired") {
      throw new ConnectorConflictError(
        "The connector command has not been dispatched and cannot be reconciled.",
        "IDEMPOTENCY_IN_PROGRESS",
        { details: { scope, state: snapshot.state } },
      );
    }
    if (!connector.reconcileCommand) {
      throw new ConnectorPolicyError(
        `Connector ${manifest.key} does not implement command reconciliation.`,
        "RECONCILIATION_NOT_SUPPORTED",
        { connector: manifest.key, operation: command.operation },
      );
    }

    const timeout = createExecutionTimeout(context.signal, this.timeoutMs);
    let resolution: ConnectorCommandResult | undefined;
    try {
      resolution = await Promise.race([
        connector.reconcileCommand({ ...context, signal: timeout.signal }, command),
        timeout.rejection,
      ]);
    } catch (error) {
      throw normalizeConnectorError(error);
    } finally {
      timeout.cleanup();
    }

    if (resolution === undefined || resolution.status === "accepted") return undefined;
    validateConnectorResult(command, resolution);
    try {
      await this.idempotencyStore.resolveIndeterminate({
        scope,
        requestHash,
        result: resolution,
        completedTtlSeconds: this.completedTtlSeconds,
      });
    } catch (error) {
      const current = await this.idempotencyStore.get(scope);
      throw new ConnectorIndeterminateError(current ?? snapshot, error);
    }
    return resolution;
  }

  private async executeReadOnly(
    connector: CodestraConnector,
    manifest: ConnectorManifest,
    context: ConnectorContext,
    command: ConnectorCommand,
  ): Promise<ConnectorCommandResult> {
    const circuitScope = `${context.tenantId}:${manifest.key}`;
    this.circuitBreaker.beforeRequest(circuitScope);
    const timeout = createExecutionTimeout(context.signal, this.timeoutMs);
    try {
      const result = await Promise.race([
        connector.execute({ ...context, signal: timeout.signal }, command),
        timeout.rejection,
      ]);
      validateConnectorResult(command, result);
      this.circuitBreaker.recordSuccess(circuitScope);
      return result;
    } catch (error) {
      this.circuitBreaker.recordFailure(circuitScope);
      throw normalizeConnectorError(error);
    } finally {
      timeout.cleanup();
    }
  }

  private async releaseBeforeDispatchOrThrow(
    lease: ConnectorIdempotencyLease,
    originalError: unknown,
  ): Promise<void> {
    try {
      await this.idempotencyStore.releaseBeforeDispatch(lease);
    } catch (releaseError) {
      throw new ConnectorError(
        "The provider was not called, but the pre-dispatch idempotency lease could not be released.",
        "IDEMPOTENCY_RELEASE_FAILED",
        { retryable: true, cause: new AggregateError([originalError, releaseError]) },
      );
    }
  }

  private async retainIndeterminate(
    lease: ConnectorIdempotencyLease,
    error: unknown,
  ): Promise<ConnectorIdempotencySnapshot> {
    const outcome = toIndeterminateOutcome(error, this.now());
    let persistenceError: unknown;
    try {
      await this.idempotencyStore.markIndeterminate(
        lease,
        outcome,
        this.indeterminateReviewTtlSeconds,
      );
    } catch (caught) {
      persistenceError = caught;
    }

    let snapshot: ConnectorIdempotencySnapshot | undefined;
    try {
      snapshot = await this.idempotencyStore.get(lease.scope);
    } catch (caught) {
      persistenceError = persistenceError === undefined
        ? caught
        : new AggregateError([persistenceError, caught]);
    }

    if (snapshot) return snapshot;
    return {
      scope: lease.scope,
      requestHash: lease.requestHash,
      commandId: lease.commandId,
      state: "dispatched",
      expiresAtEpochSeconds: Math.floor(this.now().getTime() / 1_000) + this.indeterminateReviewTtlSeconds,
      outcome: {
        ...outcome,
        ...(persistenceError === undefined
          ? {}
          : { message: `${outcome.message} Idempotency-state persistence also failed.` }),
      },
    };
  }
}

export async function computeConnectorCommandRequestHash(
  context: ConnectorContext,
  connectorKey: string,
  command: ConnectorCommand,
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ConnectorError("Web Crypto SHA-256 support is required.", "CRYPTO_UNAVAILABLE");
  }
  const fingerprint: JsonObject = {
    tenantId: context.tenantId,
    connectorKey,
    actor: {
      type: context.actor.type,
      subjectId: context.actor.subjectId,
    },
    command: {
      commandId: command.commandId,
      operation: command.operation,
      payload: command.payload,
      requestedAt: command.requestedAt,
      ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
    },
  };
  const encoded = new TextEncoder().encode(canonicalizeJson(fingerprint));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(encoded).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalizeJson(value: JsonValue): string {
  return canonicalizeUnknown(value, new Set<object>());
}

function canonicalizeUnknown(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ConnectorPolicyError("Idempotency fingerprints require finite JSON numbers.", "INVALID_JSON_VALUE");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new ConnectorPolicyError("Idempotency fingerprints do not support cyclic JSON.", "INVALID_JSON_VALUE");
    }
    ancestors.add(value);
    try {
      return `[${value.map((item) => canonicalizeUnknown(item, ancestors)).join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) {
      throw new ConnectorPolicyError("Idempotency fingerprints do not support cyclic JSON.", "INVALID_JSON_VALUE");
    }
    ancestors.add(value);
    try {
      const entries = Object.keys(value)
        .sort()
        .map((key) => {
          const item = (value as Record<string, unknown>)[key];
          if (item === undefined) {
            throw new ConnectorPolicyError(
              "Idempotency fingerprints do not support undefined JSON properties.",
              "INVALID_JSON_VALUE",
            );
          }
          return `${JSON.stringify(key)}:${canonicalizeUnknown(item, ancestors)}`;
        });
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }
  throw new ConnectorPolicyError(
    `Idempotency fingerprints do not support ${typeof value} values.`,
    "INVALID_JSON_VALUE",
  );
}

function requireOperation(manifest: ConnectorManifest, name: string): ConnectorOperation {
  const operation = manifest.operations.find((candidate) => candidate.name === name);
  if (!operation) {
    throw new ConnectorPolicyError(`Connector ${manifest.key} does not expose ${name}.`, "UNKNOWN_OPERATION");
  }
  return operation;
}

function requireCapabilities(operation: ConnectorOperation, context: ConnectorContext): void {
  for (const capability of operation.requiredCapabilities) {
    if (context.capabilities[capability] !== true) {
      throw new ConnectorPolicyError(`Capability ${capability} is required for ${operation.name}.`, "CAPABILITY_DISABLED", {
        capability,
        operation: operation.name,
      });
    }
  }
}

function validateConnectorResult(command: ConnectorCommand, result: ConnectorCommandResult): void {
  if (result.commandId !== command.commandId) {
    throw new ConnectorError("Connector returned a result for a different command.", "COMMAND_RESULT_MISMATCH");
  }
  if (result.status !== "accepted" && result.status !== "completed" && result.status !== "rejected") {
    throw new ConnectorError("Connector returned an invalid command status.", "INVALID_CONNECTOR_RESULT");
  }
}

function normalizeConnectorError(error: unknown): ConnectorError {
  return error instanceof ConnectorError
    ? error
    : new ConnectorError("Connector execution failed.", "CONNECTOR_EXECUTION_FAILED", {
        retryable: true,
        cause: error,
      });
}

function toIndeterminateOutcome(error: unknown, now: Date): ConnectorIndeterminateOutcome {
  const normalized = normalizeConnectorError(error);
  return {
    code: normalized.code,
    message: normalized.message,
    occurredAt: now.toISOString(),
    retryable: normalized.retryable,
  };
}

function requestMismatchError(snapshot: ConnectorIdempotencySnapshot | IdempotencyRecord): ConnectorConflictError {
  return new ConnectorConflictError(
    "The idempotency key was already used for a different connector command.",
    "IDEMPOTENCY_REQUEST_MISMATCH",
    {
      retryable: false,
      details: {
        scope: snapshot.scope,
        existingRequestHash: snapshot.requestHash,
        existingCommandId: snapshot.commandId,
      },
    },
  );
}

function buildIdempotencyScope(
  tenantId: UUID,
  connectorKey: string,
  operation: string,
  key: string,
): string {
  return `${tenantId}:${connectorKey}:${operation}:${key}`;
}

function toSnapshot(record: IdempotencyRecord): ConnectorIdempotencySnapshot {
  return structuredClone({
    scope: record.scope,
    requestHash: record.requestHash,
    commandId: record.commandId,
    state: record.state,
    expiresAtEpochSeconds: record.expiresAtEpochSeconds,
    ...(record.result === undefined ? {} : { result: record.result }),
    ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
  });
}

function validateIdempotencyBeginInput(input: ConnectorIdempotencyBeginInput): void {
  requireSingleLine(input.scope, "scope");
  validateRequestHash(input.requestHash);
  requireSingleLine(input.commandId, "commandId");
  positiveInteger(input.acquiredTtlSeconds, "acquiredTtlSeconds");
}

function validateLease(lease: ConnectorIdempotencyLease): void {
  requireSingleLine(lease.scope, "scope");
  validateRequestHash(lease.requestHash);
  requireSingleLine(lease.commandId, "commandId");
  requireSingleLine(lease.token, "lease token");
}

function validateRequestHash(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new ConnectorPolicyError("requestHash must be a lowercase SHA-256 digest.", "INVALID_REQUEST_HASH");
  }
  return value;
}

function abortBeforeDispatchError(reason: unknown): ConnectorError {
  return reason instanceof ConnectorError
    ? reason
    : new ConnectorError("Connector command was aborted before provider dispatch.", "REQUEST_ABORTED", {
        retryable: false,
        ...(reason === undefined ? {} : { cause: reason }),
      });
}

function validateContext(context: ConnectorContext): void {
  requireSingleLine(context.tenantId, "tenantId");
  requireSingleLine(context.correlationId, "correlationId");
  requireSingleLine(context.actor.subjectId, "actor.subjectId");
}

function validateCommand(command: ConnectorCommand): void {
  requireSingleLine(command.commandId, "commandId");
  requireSingleLine(command.operation, "operation");
  if (!Number.isFinite(Date.parse(command.requestedAt))) {
    throw new ConnectorPolicyError("requestedAt must be an ISO date-time.", "INVALID_COMMAND_TIME");
  }
  if (command.expectedVersion !== undefined && (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0)) {
    throw new ConnectorPolicyError("expectedVersion must be a non-negative integer.", "INVALID_EXPECTED_VERSION");
  }
}

function validateManifest(manifest: ConnectorManifest): ConnectorManifest {
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(manifest.key)) {
    throw new ConnectorPolicyError("Connector manifest key is invalid.", "INVALID_CONNECTOR_MANIFEST");
  }
  const names = new Set<string>();
  for (const operation of manifest.operations) {
    if (names.has(operation.name)) {
      throw new ConnectorPolicyError(`Connector operation ${operation.name} is duplicated.`, "INVALID_CONNECTOR_MANIFEST");
    }
    names.add(operation.name);
  }
  return manifest;
}

function validateIdempotencyKey(value: string | undefined): string {
  if (value === undefined) {
    throw new ConnectorPolicyError("Mutating connector commands require an idempotency key.", "IDEMPOTENCY_REQUIRED");
  }
  const key = requireSingleLine(value, "idempotencyKey");
  if (key.length < 16 || key.length > 128) {
    throw new ConnectorPolicyError("idempotencyKey must contain between 16 and 128 characters.", "INVALID_IDEMPOTENCY_KEY");
  }
  return key;
}

function requireSingleLine(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n]/u.test(normalized)) {
    throw new ConnectorPolicyError(`${name} must be a non-empty single-line value.`, "INVALID_CONTEXT");
  }
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer.`);
  return value;
}

function createExecutionTimeout(externalSignal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  rejection: Promise<never>;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const propagateAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) propagateAbort();
  else externalSignal?.addEventListener("abort", propagateAbort, { once: true });

  let rejectTimeout: (error: ConnectorTimeoutError) => void = () => undefined;
  const rejection = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    const error = new ConnectorTimeoutError(timeoutMs);
    controller.abort(error);
    rejectTimeout(error);
  }, timeoutMs);

  return {
    signal: controller.signal,
    rejection,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", propagateAbort);
    },
  };
}
