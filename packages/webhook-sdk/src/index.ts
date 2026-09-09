const DEFAULT_TOLERANCE_SECONDS = 300;
const encoder = new TextEncoder();

export interface WebhookHeaders {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
}

export interface SignWebhookInput {
  id: string;
  timestamp?: number;
  payload: string | Uint8Array;
  secret: string;
}

export interface VerifyWebhookInput {
  id: string;
  timestamp: string | number;
  signature: string;
  payload: string | Uint8Array;
  secrets: readonly string[];
  toleranceSeconds?: number;
  now?: () => number;
}

export interface VerifiedWebhook {
  id: string;
  timestamp: number;
  matchedSecretIndex: number;
}

export interface ReplayStore {
  /** Atomically claims an event ID. Returns false when it was already claimed. */
  claim(eventId: string, expiresAtEpochSeconds: number): Promise<boolean>;
}

export type WebhookSignerType = "current" | "previous";
export type WebhookProcessingState = "processing" | "processed" | "failed";

export interface WebhookProcessingScopeInput {
  tenantId: string;
  endpointId: string;
  signerType: WebhookSignerType;
  eventId: string;
}

export interface WebhookProcessingLease {
  scope: string;
  token: string;
  expiresAtEpochSeconds: number;
}

export interface WebhookProcessingSnapshot {
  scope: string;
  state: WebhookProcessingState;
  expiresAtEpochSeconds?: number;
  processedAtEpochSeconds?: number;
  failedAtEpochSeconds?: number;
  failureCode?: string;
  failureMessage?: string;
}

export type WebhookProcessingClaimResult =
  | { state: "claimed"; lease: WebhookProcessingLease }
  | { state: "processing"; snapshot: WebhookProcessingSnapshot }
  | { state: "processed"; snapshot: WebhookProcessingSnapshot }
  | { state: "failed"; snapshot: WebhookProcessingSnapshot };

export interface WebhookProcessingStore {
  /** Atomically claims processing for a scoped event. Expired processing leases may be reclaimed. */
  claimProcessing(scope: string, expiresAtEpochSeconds: number): Promise<WebhookProcessingClaimResult>;
  markProcessed(lease: WebhookProcessingLease, processedAtEpochSeconds: number): Promise<void>;
  markFailed(
    lease: WebhookProcessingLease,
    failedAtEpochSeconds: number,
    failure: { code: string; message: string },
  ): Promise<void>;
  get(scope: string): Promise<WebhookProcessingSnapshot | undefined>;
}

export interface VerifiedWebhookProcessing extends VerifiedWebhook {
  scope: string;
  lease: WebhookProcessingLease;
}

export interface VerifyAndClaimWebhookProcessingOptions extends WebhookProcessingScopeInput {
  processingTtlSeconds?: number;
  now?: () => number;
}

export class WebhookVerificationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "WebhookVerificationError";
    this.code = code;
  }
}

export class InMemoryReplayStore implements ReplayStore {
  private readonly claims = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = () => Math.floor(Date.now() / 1_000)) {
    this.now = now;
  }

  async claim(eventId: string, expiresAtEpochSeconds: number): Promise<boolean> {
    const current = this.now();
    for (const [id, expiry] of this.claims) {
      if (expiry <= current) this.claims.delete(id);
    }
    if (this.claims.has(eventId)) return false;
    this.claims.set(eventId, expiresAtEpochSeconds);
    return true;
  }
}

interface InMemoryProcessingRecord extends WebhookProcessingSnapshot {
  token?: string;
}

export class InMemoryWebhookProcessingStore implements WebhookProcessingStore {
  private readonly records = new Map<string, InMemoryProcessingRecord>();
  private readonly now: () => number;
  private readonly tokenFactory: () => string;

  constructor(options: { now?: () => number; tokenFactory?: () => string } = {}) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.tokenFactory =
      options.tokenFactory ??
      (() => {
        if (!globalThis.crypto?.randomUUID) {
          throw new WebhookVerificationError(
            "A cryptographically secure randomUUID implementation is required.",
            "CRYPTO_UNAVAILABLE",
          );
        }
        return globalThis.crypto.randomUUID();
      });
  }

  async claimProcessing(scope: string, expiresAtEpochSeconds: number): Promise<WebhookProcessingClaimResult> {
    const normalizedScope = validateProcessingScope(scope);
    validateTimestamp(expiresAtEpochSeconds);
    const current = this.now();
    const existing = this.records.get(normalizedScope);
    if (existing) {
      if (existing.state === "processed") return { state: "processed", snapshot: snapshot(existing) };
      if (existing.state === "failed") return { state: "failed", snapshot: snapshot(existing) };
      if ((existing.expiresAtEpochSeconds ?? 0) > current) {
        return { state: "processing", snapshot: snapshot(existing) };
      }
    }

    const token = validateScope(this.tokenFactory());
    const record: InMemoryProcessingRecord = {
      scope: normalizedScope,
      state: "processing",
      token,
      expiresAtEpochSeconds,
    };
    this.records.set(normalizedScope, record);
    return {
      state: "claimed",
      lease: { scope: normalizedScope, token, expiresAtEpochSeconds },
    };
  }

  async markProcessed(lease: WebhookProcessingLease, processedAtEpochSeconds: number): Promise<void> {
    const record = this.requireLease(lease);
    validateTimestamp(processedAtEpochSeconds);
    record.state = "processed";
    record.processedAtEpochSeconds = processedAtEpochSeconds;
    delete record.expiresAtEpochSeconds;
    delete record.token;
    delete record.failedAtEpochSeconds;
    delete record.failureCode;
    delete record.failureMessage;
  }

  async markFailed(
    lease: WebhookProcessingLease,
    failedAtEpochSeconds: number,
    failure: { code: string; message: string },
  ): Promise<void> {
    const record = this.requireLease(lease);
    validateTimestamp(failedAtEpochSeconds);
    const failureCode = validateScope(failure.code);
    const failureMessage = validateFailureMessage(failure.message);
    record.state = "failed";
    record.failedAtEpochSeconds = failedAtEpochSeconds;
    record.failureCode = failureCode;
    record.failureMessage = failureMessage;
    delete record.expiresAtEpochSeconds;
    delete record.token;
    delete record.processedAtEpochSeconds;
  }

  async get(scope: string): Promise<WebhookProcessingSnapshot | undefined> {
    const record = this.records.get(validateProcessingScope(scope));
    return record ? snapshot(record) : undefined;
  }

  private requireLease(lease: WebhookProcessingLease): InMemoryProcessingRecord {
    const scope = validateProcessingScope(lease.scope);
    const token = validateScope(lease.token);
    validateTimestamp(lease.expiresAtEpochSeconds);
    const record = this.records.get(scope);
    if (
      !record ||
      record.state !== "processing" ||
      record.token !== token ||
      record.expiresAtEpochSeconds !== lease.expiresAtEpochSeconds
    ) {
      throw new WebhookVerificationError("Webhook processing lease is not active.", "PROCESSING_LEASE_LOST");
    }
    return record;
  }
}

export async function signWebhook(input: SignWebhookInput): Promise<WebhookHeaders> {
  const id = validateEventId(input.id);
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1_000);
  validateTimestamp(timestamp);
  const signature = await computeSignature(input.secret, buildSignedPayload(id, timestamp, input.payload));
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  };
}

export async function verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook> {
  const id = validateEventId(input.id);
  const timestamp = parseTimestamp(input.timestamp);
  const tolerance = validateTolerance(input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS);
  const now = Math.floor((input.now?.() ?? Date.now()) / 1_000);

  if (Math.abs(now - timestamp) > tolerance) {
    throw new WebhookVerificationError("Webhook timestamp is outside the accepted tolerance.", "TIMESTAMP_OUT_OF_RANGE");
  }
  if (input.secrets.length === 0) {
    throw new WebhookVerificationError("At least one webhook secret is required.", "NO_SECRETS");
  }

  const candidates = parseSignatures(input.signature);
  const signedPayload = buildSignedPayload(id, timestamp, input.payload);

  for (let index = 0; index < input.secrets.length; index += 1) {
    const secret = input.secrets[index];
    if (secret === undefined) continue;
    const expected = fromBase64(await computeSignature(secret, signedPayload));
    for (const candidate of candidates) {
      if (constantTimeEqual(expected, candidate)) {
        return { id, timestamp, matchedSecretIndex: index };
      }
    }
  }

  throw new WebhookVerificationError("Webhook signature did not match any active secret.", "INVALID_SIGNATURE");
}

export async function verifyAndClaimWebhook(
  input: VerifyWebhookInput,
  replayStore: ReplayStore,
): Promise<VerifiedWebhook> {
  const verified = await verifyWebhook(input);
  const tolerance = validateTolerance(input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS);
  const claimed = await replayStore.claim(verified.id, verified.timestamp + tolerance + 1);
  if (!claimed) {
    throw new WebhookVerificationError("Webhook event has already been processed.", "REPLAY_DETECTED");
  }
  return verified;
}

export async function verifyAndClaimWebhookProcessing(
  input: VerifyWebhookInput,
  store: WebhookProcessingStore,
  options: VerifyAndClaimWebhookProcessingOptions,
): Promise<VerifiedWebhookProcessing> {
  const verified = await verifyWebhook(input);
  if (verified.id !== options.eventId) {
    throw new WebhookVerificationError("Webhook processing scope event ID does not match the verified event.", "SCOPE_EVENT_MISMATCH");
  }
  const now = Math.floor((options.now?.() ?? input.now?.() ?? Date.now()) / 1_000);
  const ttlSeconds = validateProcessingTtl(options.processingTtlSeconds ?? DEFAULT_TOLERANCE_SECONDS);
  const scope = buildWebhookProcessingScope(options);
  const claimed = await store.claimProcessing(scope, now + ttlSeconds);
  if (claimed.state !== "claimed") {
    throw new WebhookVerificationError(
      `Webhook event is already ${claimed.state}.`,
      claimed.state === "processed" ? "REPLAY_DETECTED" : "PROCESSING_ALREADY_CLAIMED",
    );
  }
  return { ...verified, scope, lease: claimed.lease };
}

export function buildWebhookProcessingScope(input: WebhookProcessingScopeInput): string {
  return [
    validateScope(input.tenantId),
    validateScope(input.endpointId),
    validateSignerType(input.signerType),
    validateEventId(input.eventId),
  ].join(":");
}

export function createWebhookSecret(bytes = 32): string {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) {
    throw new WebhookVerificationError("Webhook secret size must be between 16 and 128 bytes.", "INVALID_SECRET_SIZE");
  }
  if (!globalThis.crypto?.getRandomValues) {
    throw new WebhookVerificationError("A cryptographically secure random generator is required.", "CRYPTO_UNAVAILABLE");
  }
  const value = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(value);
  return `whsec_${toBase64(value)}`;
}

async function computeSignature(secret: string, message: Uint8Array): Promise<string> {
  const keyData = Uint8Array.from(decodeSecret(secret)).buffer;
  const messageData = Uint8Array.from(message).buffer;
  if (!globalThis.crypto?.subtle) {
    throw new WebhookVerificationError("Web Crypto HMAC support is required.", "CRYPTO_UNAVAILABLE");
  }
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, messageData);
  return toBase64(new Uint8Array(signature));
}

function buildSignedPayload(id: string, timestamp: number, payload: string | Uint8Array): Uint8Array {
  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const body = typeof payload === "string" ? encoder.encode(payload) : payload;
  const combined = new Uint8Array(prefix.length + body.length);
  combined.set(prefix, 0);
  combined.set(body, prefix.length);
  return combined;
}

function decodeSecret(secret: string): Uint8Array {
  if (!secret.startsWith("whsec_")) {
    throw new WebhookVerificationError("Webhook secrets must use the whsec_ prefix.", "INVALID_SECRET_FORMAT");
  }
  const decoded = fromBase64(secret.slice("whsec_".length));
  if (decoded.length < 16) {
    throw new WebhookVerificationError("Webhook secrets must contain at least 16 bytes.", "INVALID_SECRET_FORMAT");
  }
  return decoded;
}

function parseSignatures(header: string): Uint8Array[] {
  const signatures: Uint8Array[] = [];
  for (const token of header.trim().split(/\s+/u)) {
    const [version, encoded, extra] = token.split(",");
    if (version !== "v1" || !encoded || extra !== undefined) continue;
    try {
      signatures.push(fromBase64(encoded));
    } catch {
      // Ignore malformed candidates and continue checking rotated signatures.
    }
  }
  if (signatures.length === 0) {
    throw new WebhookVerificationError("Webhook signature header contains no supported v1 signatures.", "INVALID_SIGNATURE_HEADER");
  }
  return signatures;
}

function validateEventId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 200 || /[\r\n]/u.test(id)) {
    throw new WebhookVerificationError("Webhook ID must be a non-empty single-line value.", "INVALID_EVENT_ID");
  }
  return id;
}

function parseTimestamp(value: string | number): number {
  const timestamp = typeof value === "number" ? value : Number(value);
  validateTimestamp(timestamp);
  return timestamp;
}

function validateTimestamp(timestamp: number): void {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new WebhookVerificationError("Webhook timestamp must be a positive epoch-second integer.", "INVALID_TIMESTAMP");
  }
}

function validateTolerance(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 86_400) {
    throw new WebhookVerificationError("Webhook tolerance must be between 0 and 86400 seconds.", "INVALID_TOLERANCE");
  }
  return value;
}

function validateProcessingTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 86_400) {
    throw new WebhookVerificationError("Webhook processing TTL must be between 1 and 86400 seconds.", "INVALID_PROCESSING_TTL");
  }
  return value;
}

function validateSignerType(value: WebhookSignerType): WebhookSignerType {
  if (value !== "current" && value !== "previous") {
    throw new WebhookVerificationError("Webhook signer type must be current or previous.", "INVALID_SIGNER_TYPE");
  }
  return value;
}

function validateScope(value: string): string {
  const text = value.trim();
  if (!text || text.length > 200 || /[:\r\n]/u.test(text)) {
    throw new WebhookVerificationError("Webhook processing scope parts must be non-empty single-line values.", "INVALID_PROCESSING_SCOPE");
  }
  return text;
}

function validateProcessingScope(value: string): string {
  const text = value.trim();
  if (!text || text.length > 1000 || /[\r\n]/u.test(text) || text.split(":").length !== 4) {
    throw new WebhookVerificationError("Webhook processing scope must be a canonical four-part value.", "INVALID_PROCESSING_SCOPE");
  }
  return text;
}

function validateFailureMessage(value: string): string {
  const text = value.trim();
  if (!text || text.length > 1000 || /[\r\n]/u.test(text)) {
    throw new WebhookVerificationError("Webhook processing failure message must be a non-empty single-line value.", "INVALID_PROCESSING_FAILURE");
  }
  return text;
}

function snapshot(record: InMemoryProcessingRecord): WebhookProcessingSnapshot {
  return {
    scope: record.scope,
    state: record.state,
    ...(record.expiresAtEpochSeconds === undefined ? {} : { expiresAtEpochSeconds: record.expiresAtEpochSeconds }),
    ...(record.processedAtEpochSeconds === undefined ? {} : { processedAtEpochSeconds: record.processedAtEpochSeconds }),
    ...(record.failedAtEpochSeconds === undefined ? {} : { failedAtEpochSeconds: record.failedAtEpochSeconds }),
    ...(record.failureCode === undefined ? {} : { failureCode: record.failureCode }),
    ...(record.failureMessage === undefined ? {} : { failureMessage: record.failureMessage }),
  };
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return difference === 0;
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new WebhookVerificationError("Value is not valid base64.", "INVALID_BASE64");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
