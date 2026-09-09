import type { ISODateTime, JsonObject } from "@codestra/contracts";
import {
  ConnectorError,
  ConnectorPolicyError,
  type CodestraConnector,
  type ConnectorCommand,
  type ConnectorCommandResult,
  type ConnectorContext,
  type ConnectorHealth,
  type ConnectorManifest,
  type ConnectorWebhookInput,
  type NormalizedConnectorEvent,
  type ReconciliationResult,
} from "@codestra/connector-kit";

export interface RestrictedGatewayRoutes {
  health: string;
  commands: string;
  commandReconciliation: string;
  reconciliation: string;
}

export type WebhookNormalizer = (
  context: ConnectorContext,
  input: ConnectorWebhookInput,
) => Promise<readonly NormalizedConnectorEvent[]>;

export interface RestrictedGatewayAdapterConfig {
  baseUrl: string;
  tokenProvider: () => Promise<string> | string;
  workloadIdentity?: string;
  enabled?: boolean;
  enabledOperations?: readonly string[];
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  routes?: Partial<RestrictedGatewayRoutes>;
  webhookNormalizer?: WebhookNormalizer;
  /** Retries attempted after the initial try (0 disables retrying). Default 2. */
  maxRetries?: number;
  /** Base of the jittered exponential backoff between retries, in ms. Default 100. */
  retryBaseDelayMs?: number;
  /** Upper bound on any single backoff delay, including a capped Retry-After. Default 2000. */
  retryMaxDelayMs?: number;
  /** Injectable delay for tests; defaults to a real setTimeout-based wait. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_RESTRICTED_GATEWAY_ROUTES: RestrictedGatewayRoutes = {
  health: "/health/ready",
  commands: "/internal/v1/codestra/commands",
  commandReconciliation: "/internal/v1/codestra/commands/{commandId}/reconciliation",
  reconciliation: "/internal/v1/codestra/reconciliation",
};

export abstract class RestrictedGatewayAdapter implements CodestraConnector {
  private readonly descriptor: ConnectorManifest;
  private readonly baseUrl: URL;
  private readonly tokenProvider: () => Promise<string> | string;
  private readonly workloadIdentity: string | undefined;
  private readonly enabled: boolean;
  private readonly enabledOperations: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly routes: RestrictedGatewayRoutes;
  private readonly webhookNormalizer: WebhookNormalizer | undefined;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly sleepImplementation: (ms: number) => Promise<void>;

  protected constructor(descriptor: ConnectorManifest, config: RestrictedGatewayAdapterConfig) {
    this.descriptor = descriptor;
    this.baseUrl = validateBaseUrl(config.baseUrl);
    this.tokenProvider = config.tokenProvider;
    this.workloadIdentity = config.workloadIdentity;
    this.enabled = config.enabled ?? false;
    this.enabledOperations = new Set(config.enabledOperations ?? []);
    this.timeoutMs = positiveInteger(config.timeoutMs ?? 10_000, "timeoutMs");
    this.fetchImplementation = config.fetch ?? globalThis.fetch;
    this.routes = { ...DEFAULT_RESTRICTED_GATEWAY_ROUTES, ...config.routes };
    this.webhookNormalizer = config.webhookNormalizer;
    this.maxRetries = nonNegativeInteger(config.maxRetries ?? 2, "maxRetries");
    this.retryBaseDelayMs = positiveInteger(config.retryBaseDelayMs ?? 100, "retryBaseDelayMs");
    this.retryMaxDelayMs = positiveInteger(config.retryMaxDelayMs ?? 2_000, "retryMaxDelayMs");
    this.sleepImplementation =
      config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    if (typeof this.fetchImplementation !== "function") {
      throw new TypeError("A Fetch API implementation is required.");
    }
    if (this.workloadIdentity !== undefined) requireHeader(this.workloadIdentity, "workloadIdentity");
    const declared = new Set(descriptor.operations.map((operation) => operation.name));
    for (const operation of this.enabledOperations) {
      if (!declared.has(operation)) {
        throw new ConnectorPolicyError(
          `Operation ${operation} cannot be enabled because ${descriptor.key} does not declare it.`,
          "UNKNOWN_ENABLED_OPERATION",
        );
      }
    }
  }

  manifest(): ConnectorManifest {
    return this.descriptor;
  }

  async testConnection(context: ConnectorContext): Promise<ConnectorHealth> {
    if (!this.enabled) {
      return {
        status: "disabled",
        checkedAt: new Date().toISOString(),
        details: { reason: "adapter_disabled" },
      };
    }
    const startedAt = performance.now();
    try {
      await this.request<JsonObject>(context, "GET", this.routes.health);
      return {
        status: "healthy",
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    } catch (error) {
      return {
        status: error instanceof ConnectorError && error.retryable ? "degraded" : "unavailable",
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        details: {
          code: error instanceof ConnectorError ? error.code : "CONNECTION_TEST_FAILED",
        },
      };
    }
  }

  async execute(
    context: ConnectorContext,
    command: ConnectorCommand,
  ): Promise<ConnectorCommandResult> {
    this.assertEnabled();
    const operation = this.descriptor.operations.find((entry) => entry.name === command.operation);
    if (!operation) {
      throw new ConnectorPolicyError(
        `${this.descriptor.key} does not support ${command.operation}.`,
        "UNKNOWN_OPERATION",
      );
    }
    if (!this.enabledOperations.has(command.operation)) {
      throw new ConnectorPolicyError(
        `${command.operation} is disabled for ${this.descriptor.key}.`,
        "PROVIDER_OPERATION_DISABLED",
        { connector: this.descriptor.key, operation: command.operation },
      );
    }
    if (operation.mutates && !command.idempotencyKey) {
      throw new ConnectorPolicyError("Provider mutations require an idempotency key.", "IDEMPOTENCY_REQUIRED");
    }

    const response = await this.request<JsonObject>(context, "POST", this.routes.commands, {
      commandId: command.commandId,
      operation: command.operation,
      payload: command.payload,
      requestedAt: command.requestedAt,
      ...(command.expectedVersion !== undefined ? { expectedVersion: command.expectedVersion } : {}),
    }, command.idempotencyKey);

    return parseCommandReceipt(response, command.commandId);
  }

  async ingestWebhook(
    context: ConnectorContext,
    input: ConnectorWebhookInput,
  ): Promise<readonly NormalizedConnectorEvent[]> {
    this.assertEnabled();
    if (!this.webhookNormalizer) {
      throw new ConnectorPolicyError(
        `No verified webhook normalizer is configured for ${this.descriptor.key}.`,
        "WEBHOOK_VERIFIER_REQUIRED",
      );
    }
    const events = await this.webhookNormalizer(context, input);
    return events.map((event, index) => validateNormalizedEvent(this.descriptor, event, index));
  }

  async reconcile(context: ConnectorContext, cursor?: string): Promise<ReconciliationResult> {
    this.assertEnabled();
    const response = await this.request<JsonObject>(context, "POST", this.routes.reconciliation, {
      ...(cursor !== undefined ? { cursor } : {}),
    });
    if (!Array.isArray(response.items) || typeof response.hasMore !== "boolean") {
      throw new ConnectorError("Restricted gateway returned an invalid reconciliation page.", "INVALID_PROVIDER_RESPONSE");
    }
    const items = response.items.map((item, index) => {
      if (!isJsonObject(item)) {
        throw new ConnectorError(
          `Restricted gateway returned an invalid reconciliation item at index ${index}.`,
          "INVALID_PROVIDER_RESPONSE",
          { details: { index } },
        );
      }
      return item;
    });
    return {
      items,
      hasMore: response.hasMore,
      ...(typeof response.nextCursor === "string" ? { nextCursor: response.nextCursor } : {}),
    };
  }

  async reconcileCommand(
    context: ConnectorContext,
    command: ConnectorCommand,
  ): Promise<ConnectorCommandResult | undefined> {
    this.assertEnabled();
    const operation = this.descriptor.operations.find((entry) => entry.name === command.operation);
    if (!operation) {
      throw new ConnectorPolicyError(`${this.descriptor.key} does not support ${command.operation}.`, "UNKNOWN_OPERATION");
    }
    if (!operation.mutates) return undefined;
    const response = await this.request<JsonObject>(context, "POST", interpolateCommandPath(
      this.routes.commandReconciliation,
      command.commandId,
    ), {
      operation: command.operation,
      requestedAt: command.requestedAt,
    });
    if (response.result === undefined || response.result === null) return undefined;
    return parseCommandReceipt(requireJsonObject(response.result, "result"), command.commandId);
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ConnectorPolicyError(`${this.descriptor.key} adapter is disabled.`, "CONNECTOR_DISABLED");
    }
  }

  /**
   * Every call site in this class is safe to retry: the health check is a
   * GET, reconcile/reconcileCommand are read-only queries even though they
   * ride on POST, and execute() only reaches here after requiring an
   * idempotency key for mutating operations (see the check in execute()).
   * So retrying on a classified-retryable failure never risks a duplicate
   * side effect, and no per-call "is this safe to repeat" flag is needed.
   */
  private async request<T extends JsonObject>(
    context: ConnectorContext,
    method: "GET" | "POST",
    path: string,
    body?: JsonObject,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.attemptRequest<T>(context, method, path, body, idempotencyKey);
      } catch (error) {
        if (
          !(error instanceof ConnectorError) ||
          !error.retryable ||
          attempt >= this.maxRetries ||
          context.signal?.aborted
        ) {
          throw error;
        }
        await this.delayBeforeRetry(attempt, error, context);
      }
    }
  }

  private async delayBeforeRetry(attempt: number, error: ConnectorError, context: ConnectorContext): Promise<void> {
    const details = error.details;
    const retryAfterMs = typeof details?.retryAfterMs === "number" ? details.retryAfterMs : undefined;
    const delayMs = Math.min(
      this.retryMaxDelayMs,
      retryAfterMs ?? computeBackoffDelayMs(attempt, this.retryBaseDelayMs),
    );
    if (delayMs <= 0 || context.signal?.aborted) return;
    const abort = waitForAbort(context.signal);
    try {
      await Promise.race([this.sleepImplementation(delayMs), abort.promise]);
    } finally {
      abort.cancel();
    }
  }

  private async attemptRequest<T extends JsonObject>(
    context: ConnectorContext,
    method: "GET" | "POST",
    path: string,
    body?: JsonObject,
    idempotencyKey?: string,
  ): Promise<T> {
    const token = requireHeader(await this.tokenProvider(), "provider token");
    const controller = new AbortController();
    const propagateAbort = () => controller.abort(context.signal?.reason);
    if (context.signal?.aborted) propagateAbort();
    else context.signal?.addEventListener("abort", propagateAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "cache-control": "no-store",
      "x-codestra-tenant-id": requireHeader(context.tenantId, "tenantId"),
      "x-correlation-id": requireHeader(context.correlationId, "correlationId"),
    });
    if (this.workloadIdentity !== undefined) {
      headers.set("x-codestra-workload-id", requireHeader(this.workloadIdentity, "workloadIdentity"));
    }
    if (body !== undefined) headers.set("content-type", "application/json");
    if (idempotencyKey !== undefined) headers.set("idempotency-key", requireHeader(idempotencyKey, "idempotencyKey"));

    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    try {
      const response = await this.fetchImplementation(resolvePath(this.baseUrl, path), init);
      if (!response.ok) {
        const payload = await parseErrorBody(response);
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        // The restricted-gateway contract requires every error body to carry
        // its own `retryable` boolean (ErrorResponse.error.retryable in
        // codestra-restricted-gateway.openapi.yaml) -- the gateway knows
        // more about a given failure than an HTTP status code alone can
        // say, so its verdict takes priority over our own status-based
        // guess, which only applies when the body doesn't answer.
        const declaredRetryable = extractRetryable(payload);
        throw new ConnectorError(
          extractMessage(payload) ?? `Restricted gateway returned HTTP ${response.status}.`,
          extractCode(payload) ?? `PROVIDER_HTTP_${response.status}`,
          {
            retryable:
              declaredRetryable ?? [408, 425, 429, 500, 502, 503, 504].includes(response.status),
            details: {
              status: response.status,
              ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            },
          },
        );
      }
      const payload = await parseSuccessJson(response);
      return payload as T;
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      if (controller.signal.aborted) {
        throw new ConnectorError("Restricted gateway request timed out or was aborted.", "PROVIDER_REQUEST_ABORTED", {
          retryable: !context.signal?.aborted,
          cause: error,
        });
      }
      throw new ConnectorError("Restricted gateway request failed.", "PROVIDER_NETWORK_ERROR", {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", propagateAbort);
    }
  }
}

export function createManifest(input: {
  key: string;
  displayName: string;
  operations: ConnectorManifest["operations"];
  webhookEventTypes: readonly string[];
}): ConnectorManifest {
  return {
    key: input.key,
    displayName: input.displayName,
    version: "0.1.0",
    operations: input.operations,
    webhookEventTypes: input.webhookEventTypes,
  };
}

function validateBaseUrl(value: string): URL {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ConnectorPolicyError("Restricted gateway baseUrl must use HTTPS except on loopback hosts.", "INSECURE_GATEWAY_URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConnectorPolicyError("Restricted gateway baseUrl contains forbidden URL components.", "INVALID_GATEWAY_URL");
  }
  return url;
}

function resolvePath(baseUrl: URL, path: string): URL {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(path.replace(/^\/+/, ""), base);
}

function interpolateCommandPath(path: string, commandId: string): string {
  if (!path.includes("{commandId}")) {
    throw new ConnectorPolicyError(
      "Command reconciliation route must include a {commandId} path parameter.",
      "INVALID_GATEWAY_ROUTE",
    );
  }
  return path.replace("{commandId}", encodeURIComponent(commandId));
}

function requireHeader(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n]/u.test(normalized)) {
    throw new ConnectorPolicyError(`${name} must be a non-empty single-line value.`, "INVALID_GATEWAY_CONTEXT");
  }
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer.`);
  return value;
}

/** Equal-jitter exponential backoff: half fixed, half random, so a burst of
 * simultaneously-retrying callers doesn't converge on the same instant. */
function computeBackoffDelayMs(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
}

/**
 * Resolves when `signal` aborts, but -- unlike a plain `{once: true}`
 * listener -- also unregisters itself if the caller's `Promise.race` settles
 * the other way first. `signal` is typically a long-lived, per-connection
 * AbortSignal reused across many retried commands; without this cleanup,
 * every backoff that finishes without an abort would leave a listener
 * behind permanently, one per retry.
 */
function waitForAbort(signal: AbortSignal | undefined): { promise: Promise<void>; cancel: () => void } {
  if (!signal) return { promise: new Promise(() => {}), cancel: () => {} };
  if (signal.aborted) return { promise: Promise.resolve(), cancel: () => {} };
  let onAbort!: () => void;
  const promise = new Promise<void>((resolve) => {
    onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, cancel: () => signal.removeEventListener("abort", onAbort) };
}

/** Parses the HTTP Retry-After header, which is either a delay in whole
 * seconds or an HTTP-date. Returns undefined for anything else so callers
 * fall back to their own backoff instead of trusting a malformed header. */
function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (headerValue === null) return undefined;
  if (/^\d+$/.test(headerValue.trim())) {
    return Number.parseInt(headerValue, 10) * 1000;
  }
  const dateMs = Date.parse(headerValue);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

async function parseSuccessJson(response: Response): Promise<JsonObject> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ConnectorError("Restricted gateway returned a non-JSON response.", "INVALID_PROVIDER_RESPONSE");
  }
  const value = (await response.json()) as unknown;
  if (!isJsonObject(value)) {
    throw new ConnectorError("Restricted gateway returned a non-object response.", "INVALID_PROVIDER_RESPONSE");
  }
  return value;
}

async function parseErrorBody(response: Response): Promise<JsonObject> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return {};
  try {
    const value = (await response.json()) as unknown;
    return isJsonObject(value) ? value : {};
  } catch {
    return {};
  }
}

function extractCode(payload: JsonObject): string | undefined {
  return isJsonObject(payload.error) && typeof payload.error.code === "string" ? payload.error.code : undefined;
}

function extractMessage(payload: JsonObject): string | undefined {
  return isJsonObject(payload.error) && typeof payload.error.message === "string" ? payload.error.message : undefined;
}

function extractRetryable(payload: JsonObject): boolean | undefined {
  return isJsonObject(payload.error) && typeof payload.error.retryable === "boolean"
    ? payload.error.retryable
    : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireJsonObject(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new ConnectorError(`Restricted gateway returned invalid ${path}.`, "INVALID_PROVIDER_RESPONSE");
  }
  return value;
}

function parseCommandReceipt(response: JsonObject, expectedCommandId: string): ConnectorCommandResult {
  if (response.commandId !== expectedCommandId) {
    throw new ConnectorError("Restricted gateway returned a mismatched commandId.", "INVALID_PROVIDER_RESPONSE");
  }
  const status = response.status;
  if (status !== "accepted" && status !== "completed" && status !== "rejected") {
    throw new ConnectorError("Restricted gateway returned an invalid command status.", "INVALID_PROVIDER_RESPONSE");
  }
  if (response.providerReference !== undefined && typeof response.providerReference !== "string") {
    throw new ConnectorError("Restricted gateway returned an invalid providerReference.", "INVALID_PROVIDER_RESPONSE");
  }
  if (response.data !== undefined && !isJsonObject(response.data)) {
    throw new ConnectorError("Restricted gateway returned invalid command data.", "INVALID_PROVIDER_RESPONSE");
  }
  return {
    commandId: expectedCommandId,
    status,
    ...(typeof response.providerReference === "string" ? { providerReference: response.providerReference } : {}),
    ...(isJsonObject(response.data) ? { data: response.data } : {}),
    ...(typeof response.replayed === "boolean" ? { replayed: response.replayed } : {}),
  };
}

function validateNormalizedEvent(
  manifest: ConnectorManifest,
  event: NormalizedConnectorEvent,
  index: number,
): NormalizedConnectorEvent {
  if (!manifest.webhookEventTypes.includes(event.type)) {
    throw new ConnectorError(
      `Webhook normalizer returned undeclared event type at index ${index}.`,
      "UNDECLARED_PROVIDER_EVENT",
      { details: { connector: manifest.key, eventType: event.type, index } },
    );
  }
  requireHeader(event.id, `events[${index}].id`);
  requireHeader(event.source, `events[${index}].source`);
  requireHeader(event.type, `events[${index}].type`);
  if (!Number.isFinite(Date.parse(event.time))) {
    throw new ConnectorError("Webhook normalizer returned an invalid event time.", "INVALID_PROVIDER_RESPONSE", {
      details: { index },
    });
  }
  if (!isJsonObject(event.data)) {
    throw new ConnectorError("Webhook normalizer returned invalid event data.", "INVALID_PROVIDER_RESPONSE", {
      details: { index },
    });
  }
  return event;
}

export function canonicalEvent(input: {
  id: string;
  source: string;
  type: string;
  time?: ISODateTime;
  subject?: string;
  data: JsonObject;
}): NormalizedConnectorEvent {
  return {
    id: input.id,
    source: input.source,
    type: input.type,
    time: input.time ?? new Date().toISOString(),
    data: input.data,
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
  };
}
