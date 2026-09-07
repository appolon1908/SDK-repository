import { CodestraCommunicationsClient } from "@codestra/communications-sdk";
import type {
  CodestraCommunicationsClientOptions,
  CommunicationsMutationOptions,
} from "@codestra/communications-sdk";
import { CodestraClient as CodestraSocialClient } from "@codestra/social-sdk";
import type {
  CreateCommunicationMessageInput,
  CreateSocialPostInput,
  JsonObject,
  ListSocialPostsInput,
  OperationsDashboardAuthGatewayStatus,
  OperationsDashboardCanaryStatusList,
  OperationsDashboardMessageLifecycleStatus,
  OperationsDashboardOverview,
  OperationsDashboardProviderStatusList,
  OperationsDashboardQueueStatus,
  OperationsDashboardReleaseGateStatus,
  OperationsDashboardRouteStatusList,
  OperationsDashboardTenantActivityStatus,
  OperationsDashboardWebhookDeliveryStatus,
  SocialPost,
  SocialPostList,
  UUID,
} from "@codestra/contracts";
import type {
  CanonicalCommandEnvelope,
  CanonicalCommandInput,
  GenerateAiInput,
  OperationListOptions,
  OperationMutationInput,
  TriggerAutomationCommandInput,
} from "./types.js";

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface CodestraSdkOptions {
  baseUrl: string;
  tenantId: string;
  requestedBy: string;
  getAccessToken: () => Promise<string> | string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  commandIdFactory?: () => string;
  correlationIdFactory?: () => string;
}

export interface CodestraRequestOptions {
  signal?: AbortSignal;
  correlationId?: string;
}

export interface CodestraMutationOptions extends CodestraRequestOptions {
  idempotencyKey: string;
}

interface InternalRequestOptions extends CodestraRequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

export interface CanonicalDomainClient {
  submit: (input: CanonicalCommandInput, options: CodestraMutationOptions) => Promise<JsonObject>;
  list: (options?: CodestraRequestOptions) => Promise<JsonObject>;
  get: (operationId: UUID, options?: CodestraRequestOptions) => Promise<JsonObject>;
  cancel: (operationId: UUID, input: OperationMutationInput, options: CodestraMutationOptions) => Promise<JsonObject>;
  reconcile: (operationId: UUID, input: OperationMutationInput, options: CodestraMutationOptions) => Promise<JsonObject>;
}

export interface CanonicalFilteredDomainClient extends Omit<CanonicalDomainClient, "list"> {
  list: (options?: OperationListOptions) => Promise<JsonObject>;
}

export class CodestraSdkError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "CodestraSdkError";
    this.code = code;
  }
}

export class CodestraSdkConfigurationError extends CodestraSdkError {
  constructor(message: string) {
    super(message, "CONFIGURATION_ERROR");
    this.name = "CodestraSdkConfigurationError";
  }
}

export class CodestraSdkHttpError extends CodestraSdkError {
  readonly status: number;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly correlationId: string | undefined;
  readonly operationId: string | undefined;

  constructor(input: { status: number; code: string; message: string; requestId: string; retryable: boolean; correlationId: string | undefined; operationId: string | undefined }) {
    super(input.message, input.code);
    this.name = new.target.name;
    this.status = input.status;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
    this.correlationId = input.correlationId;
    this.operationId = input.operationId;
  }
}

export class AuthenticationError extends CodestraSdkHttpError {}
export class AuthorizationError extends CodestraSdkHttpError {}
export class TenantAccessError extends CodestraSdkHttpError {}
export class IdempotencyConflictError extends CodestraSdkHttpError {}
export class RateLimitError extends CodestraSdkHttpError {}
export class UnknownOutcomeError extends CodestraSdkHttpError {}
export class CapabilityDisabledError extends CodestraSdkHttpError {}

export class CodestraSdk {
  readonly platform: {
    health: (options?: CodestraRequestOptions) => Promise<JsonObject>;
    readiness: (options?: CodestraRequestOptions) => Promise<JsonObject>;
    version: (options?: CodestraRequestOptions) => Promise<JsonObject>;
    dependencies: (options?: CodestraRequestOptions) => Promise<JsonObject>;
    capabilities: (options?: CodestraRequestOptions) => Promise<JsonObject>;
  };

  readonly operations: {
    list: (options?: OperationListOptions) => Promise<JsonObject>;
    get: (operationId: UUID, options?: CodestraRequestOptions) => Promise<JsonObject>;
    cancel: (operationId: UUID, input: OperationMutationInput, options: CodestraMutationOptions) => Promise<JsonObject>;
    reconcile: (operationId: UUID, input: OperationMutationInput, options: CodestraMutationOptions) => Promise<JsonObject>;
  };

  readonly control: {
    marketing: CanonicalDomainClient;
    ai: CanonicalDomainClient;
    crm: CanonicalDomainClient;
    odoo: CanonicalDomainClient;
    n8n: CanonicalFilteredDomainClient;
    social: CanonicalDomainClient;
    telephony: CanonicalDomainClient;
  };
  readonly marketing: {
    campaigns: {
      list: (options?: CodestraRequestOptions) => Promise<JsonObject>;
      get: (campaignId: UUID, options?: CodestraRequestOptions) => Promise<JsonObject>;
    };
  };

  readonly ai: {
    generate: (input: GenerateAiInput, options: CodestraMutationOptions) => Promise<JsonObject>;
  };

  readonly communication: CodestraCommunicationsClient & {
    messages: CodestraCommunicationsClient["messages"] & {
      send: (input: CreateCommunicationMessageInput, options: CommunicationsMutationOptions) => Promise<JsonObject>;
    };
  };

  readonly social: {
    posts: {
      schedule: (input: CreateSocialPostInput, options: CodestraMutationOptions) => Promise<SocialPost>;
      create: (input: CreateSocialPostInput, options: CodestraMutationOptions) => Promise<SocialPost>;
      list: (input?: ListSocialPostsInput, options?: CodestraRequestOptions) => Promise<SocialPostList>;
      get: (postId: UUID, options?: CodestraRequestOptions) => Promise<SocialPost>;
      cancel: (postId: UUID, options: CodestraMutationOptions) => Promise<SocialPost>;
    };
  };

  readonly automation: {
    commands: {
      trigger: (input: TriggerAutomationCommandInput, options: CodestraMutationOptions) => Promise<JsonObject>;
    };
  };

  readonly operationsDashboard: {
    overview: (options?: CodestraRequestOptions) => Promise<OperationsDashboardOverview>;
    authGateway: (options?: CodestraRequestOptions) => Promise<OperationsDashboardAuthGatewayStatus>;
    routes: (options?: CodestraRequestOptions) => Promise<OperationsDashboardRouteStatusList>;
    providers: (options?: CodestraRequestOptions) => Promise<OperationsDashboardProviderStatusList>;
    messageLifecycle: (options?: CodestraRequestOptions) => Promise<OperationsDashboardMessageLifecycleStatus>;
    webhooks: (options?: CodestraRequestOptions) => Promise<OperationsDashboardWebhookDeliveryStatus>;
    tenant: (tenantId: string, options?: CodestraRequestOptions) => Promise<OperationsDashboardTenantActivityStatus>;
    queues: (options?: CodestraRequestOptions) => Promise<OperationsDashboardQueueStatus>;
    releaseGates: (options?: CodestraRequestOptions) => Promise<OperationsDashboardReleaseGateStatus>;
    canaries: (options?: CodestraRequestOptions) => Promise<OperationsDashboardCanaryStatusList>;
  };

  readonly events: {
    webhooks: CodestraSocialClient["webhooks"];
  };

  readonly common: {
    tenantId: string;
    requestedBy: string;
  };

  private readonly baseUrl: URL;
  private readonly tenantId: string;
  private readonly requestedBy: string;
  private readonly getAccessToken: () => Promise<string> | string;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly correlationIdFactory: () => string;
  private readonly commandIdFactory: () => string;

  constructor(options: CodestraSdkOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.tenantId = requireHeaderValue(options.tenantId, "tenantId");
    this.requestedBy = requireHeaderValue(options.requestedBy, "requestedBy");
    this.getAccessToken = options.getAccessToken;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = requireNonNegativeInteger(options.timeoutMs ?? 10_000, "timeoutMs", false);
    this.maxRetries = requireNonNegativeInteger(options.maxRetries ?? 2, "maxRetries", true);
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.correlationIdFactory =
      options.correlationIdFactory ??
      (() => {
        if (!globalThis.crypto?.randomUUID) {
          throw new CodestraSdkConfigurationError("A cryptographically secure randomUUID implementation is required.");
        }
        return globalThis.crypto.randomUUID();
      });
    this.commandIdFactory =
      options.commandIdFactory ??
      (() => {
        if (!globalThis.crypto?.randomUUID) {
          throw new CodestraSdkConfigurationError("A cryptographically secure randomUUID implementation is required.");
        }
        return globalThis.crypto.randomUUID();
      });

    if (typeof this.fetchImplementation !== "function") {
      throw new CodestraSdkConfigurationError("A Fetch API implementation is required.");
    }

    const socialClient = new CodestraSocialClient({
      baseUrl: this.baseUrl.toString(),
      tenantId: this.tenantId,
      getAccessToken: this.getAccessToken,
      fetch: this.fetchImplementation,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      sleep: this.sleep,
      correlationIdFactory: this.correlationIdFactory,
    });

    const communicationClient = new CodestraCommunicationsClient({
      baseUrl: this.baseUrl.toString(),
      tenantId: this.tenantId,
      requestedBy: this.requestedBy,
      getAccessToken: this.getAccessToken,
      fetch: this.fetchImplementation,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      sleep: this.sleep,
      ...(options.commandIdFactory ? { commandIdFactory: options.commandIdFactory } : {}),
      correlationIdFactory: this.correlationIdFactory,
    } satisfies CodestraCommunicationsClientOptions);

    this.platform = {
      health: (requestOptions) => this.request({ method: "GET", path: "/health", ...copyRequestOptions(requestOptions) }),
      readiness: (requestOptions) => this.request({ method: "GET", path: "/readiness", ...copyRequestOptions(requestOptions) }),
      version: (requestOptions) => this.request({ method: "GET", path: "/version", ...copyRequestOptions(requestOptions) }),
      dependencies: (requestOptions) => this.request({ method: "GET", path: "/dependencies", ...copyRequestOptions(requestOptions) }),
      capabilities: (requestOptions) => this.request({ method: "GET", path: "/capabilities", ...copyRequestOptions(requestOptions) }),
    };

    this.operations = {
      list: (requestOptions) => this.request({ method: "GET", path: withQuery("/v1/operations", requestOptions), ...copyRequestOptions(requestOptions) }),
      get: (operationId, requestOptions) => this.operationRead("/v1/operations", operationId, requestOptions),
      cancel: (operationId, input, requestOptions) => this.operationMutation("/v1/operations", operationId, "cancel", input, requestOptions),
      reconcile: (operationId, input, requestOptions) => this.operationMutation("/v1/operations", operationId, "reconcile", input, requestOptions),
    };

    this.control = {
      marketing: this.domainClient("marketing"),
      ai: this.domainClient("ai"),
      crm: this.domainClient("crm"),
      odoo: this.domainClient("odoo"),
      n8n: this.filteredDomainClient("integrations/n8n"),
      social: this.domainClient("social"),
      telephony: this.domainClient("telephony"),
    };

    this.marketing = {
      campaigns: {
        list: (requestOptions) => this.request({ method: "GET", path: "/v1/marketing/campaigns", ...copyRequestOptions(requestOptions) }),
        get: (campaignId, requestOptions) =>
          this.request({ method: "GET", path: `/v1/marketing/campaigns/${encodeURIComponent(requirePathSegment(campaignId, "campaignId"))}`, ...copyRequestOptions(requestOptions) }),
      },
    };

    this.ai = {
      generate: (input, requestOptions) =>
        this.request({
          method: "POST",
          path: "/v1/ai/generate",
          body: stripUndefined(input),
          idempotencyKey: requireIdempotencyKey(requestOptions.idempotencyKey),
          ...copyRequestOptions(requestOptions),
        }),
    };

    const communication = communicationClient as CodestraSdk["communication"];
    Object.defineProperty(communication, "messages", {
      value: {
        ...communicationClient.messages,
        send: (input: CreateCommunicationMessageInput, requestOptions: CommunicationsMutationOptions) =>
          communicationClient.messages.create(input, requestOptions) as Promise<JsonObject>,
      },
    });
    this.communication = communication;

    this.social = {
      posts: {
        schedule: (input, requestOptions) => socialClient.social.posts.create(input, requestOptions),
        create: (input, requestOptions) => socialClient.social.posts.create(input, requestOptions),
        list: (input, requestOptions) => socialClient.social.posts.list(input, requestOptions),
        get: (postId, requestOptions) => socialClient.social.posts.get(postId, requestOptions),
        cancel: (postId, requestOptions) => socialClient.social.posts.cancel(postId, requestOptions),
      },
    };

    this.automation = {
      commands: {
        // Submits through the real, already-implemented canonical command
        // plane (POST /v1/commands) rather than a dedicated workflow route --
        // there isn't one. Read the result back with sdk.operations.get(),
        // the same generic operation collection every canonical command
        // uses. See the AUTOMATION_TRIGGER capability doc comment above
        // submitCanonicalCommand's call site for the command_type/target
        // convention this uses.
        trigger: (input, requestOptions) =>
          this.submitCanonicalCommand(
            "/v1/commands",
            {
              ...(input.commandId !== undefined ? { commandId: input.commandId } : {}),
              commandType: "automation.workflow.trigger",
              target: "n8n",
              capability: "AUTOMATION_TRIGGER",
              payload: stripUndefined({
                workflow_key: input.workflowKey,
                workflow_family: input.workflowFamily,
                workflow_version: input.workflowVersion,
                payload: input.payload,
              }) as JsonObject,
            },
            requestOptions,
          ),
      },
    };

    this.operationsDashboard = {
      overview: (requestOptions) =>
        this.request<OperationsDashboardOverview>({ method: "GET", path: "/v1/operations-dashboard/overview", ...copyRequestOptions(requestOptions) }),
      authGateway: (requestOptions) =>
        this.request<OperationsDashboardAuthGatewayStatus>({ method: "GET", path: "/v1/operations-dashboard/auth-gateway", ...copyRequestOptions(requestOptions) }),
      routes: (requestOptions) =>
        this.request<OperationsDashboardRouteStatusList>({ method: "GET", path: "/v1/operations-dashboard/routes", ...copyRequestOptions(requestOptions) }),
      providers: (requestOptions) =>
        this.request<OperationsDashboardProviderStatusList>({ method: "GET", path: "/v1/operations-dashboard/providers", ...copyRequestOptions(requestOptions) }),
      messageLifecycle: (requestOptions) =>
        this.request<OperationsDashboardMessageLifecycleStatus>({ method: "GET", path: "/v1/operations-dashboard/messages/lifecycle", ...copyRequestOptions(requestOptions) }),
      webhooks: (requestOptions) =>
        this.request<OperationsDashboardWebhookDeliveryStatus>({ method: "GET", path: "/v1/operations-dashboard/webhooks", ...copyRequestOptions(requestOptions) }),
      tenant: (tenantId, requestOptions) =>
        this.request<OperationsDashboardTenantActivityStatus>({ method: "GET", path: `/v1/operations-dashboard/tenants/${encodeURIComponent(requirePathSegment(tenantId, "tenantId"))}`, ...copyRequestOptions(requestOptions) }),
      queues: (requestOptions) =>
        this.request<OperationsDashboardQueueStatus>({ method: "GET", path: "/v1/operations-dashboard/queues", ...copyRequestOptions(requestOptions) }),
      releaseGates: (requestOptions) =>
        this.request<OperationsDashboardReleaseGateStatus>({ method: "GET", path: "/v1/operations-dashboard/release-gates", ...copyRequestOptions(requestOptions) }),
      canaries: (requestOptions) =>
        this.request<OperationsDashboardCanaryStatusList>({ method: "GET", path: "/v1/operations-dashboard/canaries", ...copyRequestOptions(requestOptions) }),
    };

    this.events = {
      webhooks: socialClient.webhooks,
    };

    this.common = {
      tenantId: this.tenantId,
      requestedBy: this.requestedBy,
    };
  }

  private async request<T = JsonObject>(options: InternalRequestOptions): Promise<T> {
    const correlationId = requireHeaderValue(options.correlationId ?? this.correlationIdFactory(), "correlationId");
    const token = requireHeaderValue(await this.getAccessToken(), "access token");
    const url = new URL(options.path.replace(/^\/+/, ""), ensureTrailingSlash(this.baseUrl));
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "x-tenant-id": this.tenantId,
      "x-codestra-tenant-id": this.tenantId,
      "x-correlation-id": correlationId,
    });
    if (options.idempotencyKey !== undefined) headers.set("idempotency-key", requireHeaderValue(options.idempotencyKey, "idempotencyKey"));
    if (options.body !== undefined) headers.set("content-type", "application/json");

    const requestInit: RequestInit = {
      method: options.method,
      headers,
      signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    };
    if (options.body !== undefined) requestInit.body = JSON.stringify(options.body);

    const response = await this.fetchImplementation(url, requestInit);

    if (response.ok) {
      if (response.status === 204) return {} as T;
      return (await response.json()) as T;
    }

    throw await parseHttpError(response, correlationId);
  }

  private domainClient(domain: string): CanonicalDomainClient {
    const root = `/v1/${domain}`;
    return {
      submit: (input, requestOptions) => this.submitCanonicalCommand(`${root}/commands`, input, requestOptions),
      list: (requestOptions) => this.request({ method: "GET", path: `${root}/operations`, ...copyRequestOptions(requestOptions) }),
      get: (operationId, requestOptions) => this.operationRead(`${root}/operations`, operationId, requestOptions),
      cancel: (operationId, input, requestOptions) => this.operationMutation(`${root}/operations`, operationId, "cancel", input, requestOptions),
      reconcile: (operationId, input, requestOptions) => this.operationMutation(`${root}/operations`, operationId, "reconcile", input, requestOptions),
    };
  }

  private filteredDomainClient(domain: string): CanonicalFilteredDomainClient {
    const client = this.domainClient(domain);
    return {
      ...client,
      list: (requestOptions) => this.request({ method: "GET", path: withQuery(`/v1/${domain}/operations`, requestOptions), ...copyRequestOptions(requestOptions) }),
    };
  }

  private submitCanonicalCommand(path: string, input: CanonicalCommandInput, options: CodestraMutationOptions): Promise<JsonObject> {
    const correlationId = requireHeaderValue(options.correlationId ?? this.correlationIdFactory(), "correlationId");
    const idempotencyKey = requireCanonicalIdempotencyKey(options.idempotencyKey);
    const envelope: CanonicalCommandEnvelope = {
      command_id: requireUuid(input.commandId ?? this.commandIdFactory(), "commandId"),
      command_type: requireCommandType(input.commandType),
      command_version: "1.0",
      target: requireTarget(input.target),
      tenant_id: this.tenantId,
      requested_by: this.requestedBy,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
      capability: requireCapability(input.capability),
      payload: input.payload,
    };
    return this.request({ method: "POST", path, body: envelope, idempotencyKey, correlationId, ...(options.signal ? { signal: options.signal } : {}) });
  }

  private operationRead(root: string, operationId: UUID, options?: CodestraRequestOptions): Promise<JsonObject> {
    return this.request({ method: "GET", path: `${root}/${encodeURIComponent(requireUuid(operationId, "operationId"))}`, ...copyRequestOptions(options) });
  }

  private operationMutation(root: string, operationId: UUID, action: "cancel" | "reconcile", input: OperationMutationInput, options: CodestraMutationOptions): Promise<JsonObject> {
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1) throw new CodestraSdkConfigurationError("expected_version must be a positive integer.");
    const reason = requireHeaderValue(input.reason, "reason");
    return this.request({
      method: "POST",
      path: `${root}/${encodeURIComponent(requireUuid(operationId, "operationId"))}/${action}`,
      body: { expected_version: input.expected_version, reason },
      idempotencyKey: requireCanonicalIdempotencyKey(options.idempotencyKey),
      ...copyRequestOptions(options),
    });
  }
}

export function createCodestraSdk(options: CodestraSdkOptions): CodestraSdk {
  return new CodestraSdk(options);
}

function copyRequestOptions(options: CodestraRequestOptions | undefined): CodestraRequestOptions {
  const copied: CodestraRequestOptions = {};
  if (options?.signal !== undefined) copied.signal = options.signal;
  if (options?.correlationId !== undefined) copied.correlationId = options.correlationId;
  return copied;
}

function validateBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CodestraSdkConfigurationError("baseUrl must be an absolute URL.");
  }

  const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalDevelopment)) {
    throw new CodestraSdkConfigurationError("baseUrl must use HTTPS except for loopback development.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CodestraSdkConfigurationError("baseUrl must not contain credentials, query parameters, or fragments.");
  }
  return url;
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url);
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
}

function requireHeaderValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/u.test(trimmed)) {
    throw new CodestraSdkConfigurationError(`${name} must be a non-empty single-line value.`);
  }
  return trimmed;
}

function requirePathSegment(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === "..") {
    throw new CodestraSdkConfigurationError(`${name} must be a non-empty identifier.`);
  }
  return normalized;
}

function requireUuid(value: string, name: string): string {
  const normalized = requirePathSegment(value, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(normalized)) {
    throw new CodestraSdkConfigurationError(`${name} must be a UUID.`);
  }
  return normalized;
}

function requireCommandType(value: string): string {
  const normalized = requireHeaderValue(value, "commandType");
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u.test(normalized) || normalized.length > 180) throw new CodestraSdkConfigurationError("commandType is invalid.");
  return normalized;
}

function requireTarget(value: string): string {
  const normalized = requireHeaderValue(value, "target");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized) || normalized.length > 100) throw new CodestraSdkConfigurationError("target is invalid.");
  return normalized;
}

function requireCapability(value: string): string {
  const normalized = requireHeaderValue(value, "capability");
  if (!/^[A-Z][A-Z0-9_]{2,100}$/u.test(normalized)) throw new CodestraSdkConfigurationError("capability is invalid.");
  return normalized;
}

function requireIdempotencyKey(value: string): string {
  const key = requireHeaderValue(value, "idempotencyKey");
  if (key.length < 16 || key.length > 128) {
    throw new CodestraSdkConfigurationError("idempotencyKey must contain between 16 and 128 characters.");
  }
  return key;
}

function requireCanonicalIdempotencyKey(value: string): string {
  const key = requireHeaderValue(value, "idempotencyKey");
  if (key.length < 8 || key.length > 180) {
    throw new CodestraSdkConfigurationError("idempotencyKey must contain between 8 and 180 characters.");
  }
  return key;
}

function requireNonNegativeInteger(value: number, name: string, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new CodestraSdkConfigurationError(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }
  return value;
}

function withQuery(path: string, query: object | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (["signal", "correlationId"].includes(key) || value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

async function parseHttpError(response: Response, fallbackRequestId: string): Promise<CodestraSdkHttpError> {
  let body: { error?: { code?: string; message?: string; requestId?: string; request_id?: string; correlation_id?: string; operation_id?: string; retryable?: boolean } } | undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = undefined;
    }
  }

  const input = {
    status: response.status,
    code: body?.error?.code ?? `HTTP_${response.status}`,
    message: body?.error?.message ?? `Codestra request failed with HTTP ${response.status}.`,
    requestId: body?.error?.requestId ?? body?.error?.request_id ?? response.headers.get("x-request-id") ?? fallbackRequestId,
    retryable: body?.error?.retryable ?? RETRYABLE_STATUS_CODES.has(response.status),
    correlationId: body?.error?.correlation_id,
    operationId: body?.error?.operation_id,
  };
  const ErrorType = errorType(input.code, response.status);
  return new ErrorType(input);
}

function errorType(code: string, status: number): typeof CodestraSdkHttpError {
  if (status === 401 || ["AUTHENTICATION_REQUIRED", "TOKEN_INVALID", "TOKEN_EXPIRED", "AUDIENCE_INVALID"].includes(code)) return AuthenticationError;
  if (code === "TENANT_ACCESS_DENIED") return TenantAccessError;
  if (code === "CAPABILITY_DISABLED") return CapabilityDisabledError;
  if (status === 403 || code === "SCOPE_DENIED") return AuthorizationError;
  if (code === "IDEMPOTENCY_CONFLICT") return IdempotencyConflictError;
  if (status === 429 || code === "RATE_LIMITED") return RateLimitError;
  if (["UNKNOWN_OUTCOME", "UNKNOWN_PROVIDER_OUTCOME"].includes(code)) return UnknownOutcomeError;
  return CodestraSdkHttpError;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (typeof value !== "object" || value === null) return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) output[key] = stripUndefined(item);
  }
  return output;
}
