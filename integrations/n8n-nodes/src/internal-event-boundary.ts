import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseTree, type Node as JsonNode, type ParseError } from "jsonc-parser";
import { verifyWebhook, WebhookVerificationError } from "@codestra/webhook-sdk";
import { eventSchemas } from "./event-schemas.js";
import { InboundEventError } from "./inbound-error.js";
import { claimDurableReplay, type RedisReplayConfig, type ReplayClaim } from "./redis-replay-store.js";

export { InboundEventError } from "./inbound-error.js";
const ajv = new Ajv2020({ allErrors: false, strict: true });
addFormats.default(ajv);
const validators = Object.fromEntries(Object.entries(eventSchemas).map(([type, schema]) => [type, ajv.compile(schema)]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type Headers = Readonly<Record<string, string | readonly string[] | undefined>>;
type Credentials = Readonly<Record<string, unknown>>;

export interface InternalEventInput {
  rawBody: Uint8Array;
  headers: Headers;
  credentials: Credentials;
  now?: () => number;
  /** Dependency injection for tests or an equivalently durable security store. */
  claim?: (config: RedisReplayConfig, claim: ReplayClaim) => Promise<void>;
}

function field(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f]/u.test(value)) {
    throw new InboundEventError("INVALID_INBOUND_CONFIGURATION", 503);
  }
  return value;
}
function list(value: unknown): string[] {
  if (typeof value !== "string") throw new InboundEventError("INVALID_INBOUND_CONFIGURATION", 503);
  const items = value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  if (items.length === 0 || items.length > 32) throw new InboundEventError("INVALID_INBOUND_CONFIGURATION", 503);
  return items.map((item) => field(item));
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < min || result > max) {
    throw new InboundEventError("INVALID_INBOUND_CONFIGURATION", 503);
  }
  return result;
}
function header(headers: Headers, name: string): string {
  const found = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  const value = found[0]?.[1];
  if (found.length !== 1 || typeof value !== "string" || !value || value.length > 4096 || /[\r\n]/u.test(value)) {
    throw new InboundEventError("INVALID_SIGNATURE_HEADERS", 401);
  }
  return value;
}

function parseJson(raw: Uint8Array): Record<string, unknown> {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const errors: ParseError[] = [];
    const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
    if (!tree || errors.length || tree.type !== "object") throw new Error();
    function check(node: JsonNode, depth: number): void {
      if (depth > 32) throw new Error();
      if (node.type === "object") {
        const keys = node.children?.map((property) => property.children?.[0]?.value);
        if (keys && new Set(keys).size !== keys.length) throw new Error();
      }
      if (node.type === "number" && !Number.isFinite(node.value)) throw new Error();
      for (const child of node.children ?? []) check(child, depth + 1);
    }
    check(tree, 0);
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new InboundEventError("INVALID_EVENT_JSON", 400);
  }
}

export async function acceptSignedInternalEvent(input: InternalEventInput): Promise<Record<string, unknown>> {
  const c = input.credentials;
  const tenant = field(c.expectedTenantId, 36).toLowerCase();
  if (!uuid.test(tenant)) throw new InboundEventError("INVALID_INBOUND_CONFIGURATION", 503);
  const secrets = list(c.webhookSecrets);
  if (secrets.length > 3) throw new InboundEventError("INVALID_INBOUND_CONFIGURATION", 503);
  for (const secret of secrets) {
    try {
      const encoded = secret.slice(6);
      const decoded = atob(encoded);
      if (!secret.startsWith("whsec_") || decoded.length < 32 || btoa(decoded) !== encoded) throw new Error();
    } catch { throw new InboundEventError("INVALID_INBOUND_CONFIGURATION", 503); }
  }
  const sources = list(c.allowedSources);
  const types = list(c.allowedEventTypes);
  if (types.some((type) => !Object.hasOwn(validators, type))) throw new InboundEventError("INVALID_INBOUND_CONFIGURATION", 503);
  const tolerance = integer(c.timestampToleranceSeconds, 300, 0, 3600);
  const maxBody = integer(c.maxBodyBytes, 1_048_576, 1, 1_048_576);
  const timeoutMs = integer(c.replayTimeoutMs, 5000, 100, 30_000);
  if (!(input.rawBody instanceof Uint8Array)) throw new InboundEventError("RAW_BODY_UNAVAILABLE", 400);
  if (input.rawBody.length === 0 || input.rawBody.length > maxBody) throw new InboundEventError("INVALID_EVENT_SIZE", 413);
  const id = header(input.headers, "webhook-id");
  const timestamp = header(input.headers, "webhook-timestamp");
  if (!uuid.test(id) || !/^[1-9]\d{0,12}$/u.test(timestamp)) throw new InboundEventError("INVALID_SIGNATURE_HEADERS", 401);
  try {
    await verifyWebhook({ id, timestamp, signature: header(input.headers, "webhook-signature"), payload: input.rawBody,
      secrets, toleranceSeconds: tolerance, ...(input.now === undefined ? {} : { now: input.now }) });
  } catch (error) {
    if (error instanceof InboundEventError) throw error;
    if (error instanceof WebhookVerificationError) throw new InboundEventError("INVALID_EVENT_SIGNATURE", 401);
    throw new InboundEventError("SIGNATURE_VERIFIER_UNAVAILABLE", 503);
  }
  const event = parseJson(input.rawBody);
  const type = event.type;
  if (typeof type !== "string" || !types.includes(type) || !Object.hasOwn(validators, type)) throw new InboundEventError("EVENT_TYPE_NOT_ALLOWED", 403);
  if (!validators[type]!(event)) throw new InboundEventError("INVALID_EVENT_SCHEMA", 422);
  if (event.id !== id) throw new InboundEventError("EVENT_ID_MISMATCH", 422);
  if (typeof event.tenantid !== "string" || event.tenantid.toLowerCase() !== tenant) throw new InboundEventError("EVENT_TENANT_MISMATCH", 403);
  if (typeof event.source !== "string" || !sources.includes(event.source)) throw new InboundEventError("EVENT_SOURCE_NOT_ALLOWED", 403);
  if (type === "codestra.social.post.status.v1") {
    const data = event.data as Record<string, unknown>;
    if ((data.tenantId as string).toLowerCase() !== tenant) throw new InboundEventError("EVENT_TENANT_MISMATCH", 403);
  }
  let url: URL;
  try { url = new URL(field(c.replayRedisUrl)); } catch { throw new InboundEventError("INVALID_REPLAY_CONFIGURATION", 503); }
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "rediss:" && !(url.protocol === "redis:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new InboundEventError("INVALID_REPLAY_CONFIGURATION", 503);
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && (!c.replayUsername || !c.replayPassword)) {
    throw new InboundEventError("REPLAY_AUTHENTICATION_REQUIRED", 503);
  }
  const config: RedisReplayConfig = { url: url.href, timeoutMs,
    ...(c.replayUsername ? { username: field(c.replayUsername) } : {}),
    ...(c.replayPassword ? { password: field(c.replayPassword) } : {}) };
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(input.rawBody).buffer));
  await (input.claim ?? claimDurableReplay)(config, { tenantId: tenant, eventId: id.toLowerCase(),
    bodySha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    retentionSeconds: Math.max(86_400, tolerance * 2 + 1) });
  return event;
}
