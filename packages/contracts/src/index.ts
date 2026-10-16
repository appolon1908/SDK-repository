export const CONTRACT_VERSION = "0.1.0" as const;
export type { BusinessEventEnvelope, KlyrowDailyUsage, KlyrowDailyUsageEvent } from "./business-events.js";

export type UUID = string;
export type ISODateTime = string;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type CommunicationChannel = "email" | "sms" | "voice";

export type CommunicationMessageStatus =
  | "accepted"
  | "queued"
  | "dispatched"
  | "delivered"
  | "failed"
  | "cancelled"
  | "suppressed"
  | "expired"
  | "indeterminate";

export type CommunicationMessageDirection = "outbound" | "inbound";

export interface CommunicationMessageContent {
  subject?: string;
  text?: string;
  html?: string;
  templateId?: UUID;
  templateVersion?: number;
  variables?: JsonObject;
  mediaUrls?: string[];
}

export interface CreateCommunicationMessageInput {
  channel: CommunicationChannel;
  from?: string;
  to: string[];
  senderIdentityId?: UUID;
  domainId?: UUID;
  content: CommunicationMessageContent;
  scheduledAt?: ISODateTime;
  metadata?: JsonObject;
}

export interface CommunicationMessage {
  messageId: UUID;
  tenantId: string;
  channel: CommunicationChannel;
  direction: CommunicationMessageDirection;
  status: CommunicationMessageStatus;
  correlationId: string;
  idempotencyKey: string;
  operationId?: UUID | null;
  provider?: string | null;
  providerReference?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  createdAt: ISODateTime;
  acceptedAt?: ISODateTime | null;
  dispatchedAt?: ISODateTime | null;
  completedAt?: ISODateTime | null;
  updatedAt: ISODateTime;
  metadata?: JsonObject;
}

export interface CommunicationMessageList {
  items: CommunicationMessage[];
  nextCursor?: string | null;
}

export interface CommunicationMessageEvent {
  eventId: UUID;
  messageId: UUID;
  type: string;
  status: CommunicationMessageStatus;
  occurredAt: ISODateTime;
  provider?: string | null;
  providerReference?: string | null;
  metadata?: JsonObject;
}

export interface CommunicationTemplate {
  templateId: UUID;
  channel: CommunicationChannel;
  name: string;
  locale: string;
  version: number;
  status: "draft" | "active" | "archived";
  content: CommunicationMessageContent;
  variables: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metadata?: JsonObject;
}

export interface CommunicationSenderIdentity {
  senderIdentityId: UUID;
  channel: CommunicationChannel;
  address: string;
  displayName?: string;
  domainId?: UUID;
  status: "pending" | "active" | "suspended" | "removed";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metadata?: JsonObject;
}

export type CommunicationVerificationState =
  | "not_configured"
  | "pending"
  | "valid"
  | "invalid"
  | "degraded";

export interface CommunicationDomain {
  domainId: UUID;
  domain: string;
  status: "pending" | "dns_required" | "verifying" | "verified" | "sending_enabled" | "suspended" | "removed";
  checks: {
    spf: CommunicationVerificationState;
    dkim: CommunicationVerificationState;
    dmarc: CommunicationVerificationState;
    reverseDns: CommunicationVerificationState;
    tls: CommunicationVerificationState;
    bimi: CommunicationVerificationState;
  };
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metadata?: JsonObject;
}

export interface CommunicationSuppression {
  suppressionId: UUID;
  channel: CommunicationChannel;
  subject: string;
  reason: "hard_bounce" | "complaint" | "unsubscribe" | "sms_opt_out" | "policy" | "manual";
  scope: "tenant" | "global";
  source?: string;
  createdAt: ISODateTime;
  metadata?: JsonObject;
}

export interface CommunicationPreference {
  preferenceId: UUID;
  subject: string;
  channel: CommunicationChannel;
  topic?: string;
  consent: "granted" | "denied" | "unknown";
  source?: string;
  updatedAt: ISODateTime;
  metadata?: JsonObject;
}

export type CommunicationProviderHealthStatus = "healthy" | "degraded" | "unavailable" | "disabled";
export type CommunicationReputationStatus = "good" | "watch" | "limited" | "suspended";

export interface CommunicationProviderHealth {
  status: CommunicationProviderHealthStatus;
  checkedAt: ISODateTime;
  providers: Array<{
    provider: string;
    channel: CommunicationChannel;
    status: CommunicationProviderHealthStatus;
    reason?: string | null;
  }>;
}

export interface CommunicationUsageReport {
  from: ISODateTime;
  to: ISODateTime;
  totals: Array<{
    channel: CommunicationChannel;
    accepted: number;
    delivered: number;
    failed: number;
    suppressed: number;
    costMinorUnits?: number;
    currency?: string;
  }>;
}

export interface CommunicationReputationReport {
  status: CommunicationReputationStatus;
  checkedAt: ISODateTime;
  domains: Array<{
    domain: string;
    status: CommunicationReputationStatus;
    dkim?: CommunicationVerificationState;
    spf?: CommunicationVerificationState;
    dmarc?: CommunicationVerificationState;
  }>;
  providers: Array<{
    provider: string;
    channel: CommunicationChannel;
    status: CommunicationReputationStatus;
    queueDepth?: number;
  }>;
}

export type OperationsDashboardStatus =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "disabled"
  | "pending_staging_evidence"
  | "blocked";

export type OperationsDashboardStatusCounts = Record<string, number>;

export interface OperationsDashboardBase {
  schemaVersion: "1.0";
  checkedAt: ISODateTime;
  tenantId: string;
}

export interface OperationsDashboardOverview extends OperationsDashboardBase {
  environment: string;
  release?: JsonObject;
  readiness: JsonObject;
  messages: OperationsDashboardStatusCounts;
  commands: OperationsDashboardStatusCounts;
  externalEffects: Record<string, boolean>;
  productionActivationConfigured: boolean;
}

export interface OperationsDashboardAuthGatewayStatus extends OperationsDashboardBase {
  issuer: string;
  gateway: "kong";
  expectedAudience: string;
  runtimeProfileId?: string;
  requiredHeaders: string[];
  commandPlaneHeaders: string[];
}

export interface OperationsDashboardRouteStatusList extends OperationsDashboardBase {
  routes: Array<{
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    scope: string;
  }>;
}

export interface OperationsDashboardProviderStatusList extends OperationsDashboardBase {
  summaryStatus: OperationsDashboardStatus;
  providers: Array<{
    provider: string;
    channel: string;
    status: OperationsDashboardStatus;
    reason?: string | null;
  } & JsonObject>;
}

export interface OperationsDashboardMessageLifecycleStatus extends OperationsDashboardBase {
  counts: OperationsDashboardStatusCounts;
}

export interface OperationsDashboardWebhookDeliveryStatus extends OperationsDashboardBase {
  delivery: {
    available: boolean;
    reason?: string;
  } & JsonObject;
}

export interface OperationsDashboardTenantActivityStatus extends OperationsDashboardBase {
  messages: OperationsDashboardStatusCounts;
  commands: OperationsDashboardStatusCounts;
}

export interface OperationsDashboardQueueStatus extends OperationsDashboardBase {
  commands: OperationsDashboardStatusCounts;
  messageLifecycle: OperationsDashboardStatusCounts;
}

export interface OperationsDashboardReleaseGateStatus extends OperationsDashboardBase {
  gates: {
    stagingSafe: boolean;
    allExternalEffectsDisabled: boolean;
    providerEffectsDisabled: boolean;
    productionActivationConfigured: boolean;
    productionDialing: string;
  };
}

export interface OperationsDashboardCanaryStatusList extends OperationsDashboardBase {
  canaries: Array<{
    id: string;
    channel: string;
    status: OperationsDashboardStatus;
  }>;
}

export type SocialChannel =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "x"
  | "youtube"
  | "tiktok";

export type SocialPostStatus =
  | "accepted"
  | "scheduled"
  | "publishing"
  | "published"
  | "partially_published"
  | "failed"
  | "cancelled";

export interface SocialPostContent {
  text: string;
  mediaUrls?: string[];
  linkUrl?: string;
}

export interface CreateSocialPostInput {
  workspaceId: UUID;
  channels: SocialChannel[];
  content: SocialPostContent;
  publishAt?: ISODateTime;
  metadata?: JsonObject;
}

export interface ListSocialPostsInput {
  cursor?: string;
  limit?: number;
  workspaceId?: UUID;
  status?: SocialPostStatus;
}

export interface ChannelDelivery {
  channel: SocialChannel;
  status: SocialPostStatus;
  externalId?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface SocialPost {
  id: UUID;
  tenantId: UUID;
  workspaceId: UUID;
  status: SocialPostStatus;
  channels: ChannelDelivery[];
  content: SocialPostContent;
  publishAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SocialPostList {
  items: SocialPost[];
  nextCursor?: string;
}

export interface WebhookSubscriptionInput {
  endpointUrl: string;
  eventTypes: string[];
  description?: string;
}

export interface WebhookSubscription {
  id: UUID;
  endpointUrl: string;
  eventTypes: string[];
  status: "pending_verification" | "active" | "disabled" | "verification_failed";
  verification?: {
    status: "pending" | "verified" | "failed";
    challengeId?: string;
    verifiedAt?: ISODateTime;
    lastAttemptAt?: ISODateTime;
    failureCode?: string;
  };
  destinationPolicy?: {
    httpsOnly: true;
    privateAddressBlocked: true;
    redirectsBlocked: true;
  };
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  disabledAt?: ISODateTime;
}

export interface WebhookSubscriptionCreated {
  subscription: WebhookSubscription;
  signingSecret: string;
}

export interface WebhookSubscriptionList {
  items: WebhookSubscription[];
  nextCursor?: string;
}

export interface WebhookDeliveryTest {
  deliveryId: UUID;
  subscriptionId: UUID;
  status: "queued" | "rejected";
  acceptedAt: ISODateTime;
}

export interface WebhookSubscriptionSecretRotation {
  subscription: WebhookSubscription;
  signingSecret: string;
  previousSecretExpiresAt: ISODateTime;
}

export interface CodestraErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    details?: JsonObject;
  };
}

export interface CloudEvent<TData = JsonObject> {
  specversion: "1.0";
  id: UUID;
  source: string;
  type: string;
  subject?: string;
  time: ISODateTime;
  datacontenttype: "application/json";
  dataschema?: string;
  data: TData;
}

export interface SocialPostStatusEventData {
  postId: UUID;
  tenantId: UUID;
  previousStatus?: SocialPostStatus;
  status: SocialPostStatus;
  deliveries: ChannelDelivery[];
  occurredAt: ISODateTime;
}

export * from "./kyqra.js";
