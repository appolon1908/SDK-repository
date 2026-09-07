export const CONTRACT_VERSION = "0.1.0" as const;

export type UUID = string;
export type ISODateTime = string;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

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

export interface WebhookSubscriptionInput {
  endpointUrl: string;
  eventTypes: string[];
  description?: string;
}

export interface WebhookSubscription {
  id: UUID;
  endpointUrl: string;
  eventTypes: string[];
  status: "active" | "disabled";
  createdAt: ISODateTime;
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
  tenantid: UUID;
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
