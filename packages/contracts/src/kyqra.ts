import type { ISODateTime, JsonObject, UUID } from "./index.js";

export type KyqraCrawlerEventType =
  | "kyqra.job.completed.v1"
  | "kyqra.job.failed.v1"
  | "kyqra.result.review-required.v1"
  | "kyqra.progress.v1";

export interface KyqraCrawlerProvenance {
  source_url: string;
  capture_method: "http" | "browser" | "api" | "document";
  fetched_at?: ISODateTime;
  content_type?: string | null;
  content_sha256?: string | null;
  locator?: string;
  extractor?: string;
  [key: string]: string | undefined | null;
}

export interface KyqraCrawlerEvidence {
  kind: string;
  locator: string;
  quote?: string;
}

export interface KyqraCrawlerResult {
  record_id: string;
  source_url: string;
  data: JsonObject;
  provenance: Record<string, string>;
  review_required: boolean;
  confidence?: number | null;
  capture_method?: "http" | "browser" | "api" | "document";
  content_type?: string | null;
  content_sha256?: string | null;
  evidence?: KyqraCrawlerEvidence[];
}

export interface KyqraCrawlerProgress {
  processed: number;
  records: number;
  failed: number;
}

export interface KyqraCrawlerJobCompletedPayload {
  status: "completed";
  progress: KyqraCrawlerProgress;
  results: KyqraCrawlerResult[];
}

export interface KyqraCrawlerJobFailedPayload {
  status: "failed";
  error: string;
  progress: KyqraCrawlerProgress;
}

export interface KyqraCrawlerReviewRequiredPayload {
  status: "review_required";
  result: KyqraCrawlerResult;
}

export interface KyqraCrawlerProgressPayload {
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: KyqraCrawlerProgress;
}

export type KyqraCrawlerEventPayload =
  | KyqraCrawlerJobCompletedPayload
  | KyqraCrawlerJobFailedPayload
  | KyqraCrawlerReviewRequiredPayload
  | KyqraCrawlerProgressPayload;

export interface KyqraCrawlerEventEnvelope<
  TPayload extends KyqraCrawlerEventPayload = KyqraCrawlerEventPayload,
> {
  event_id: UUID;
  event_type: KyqraCrawlerEventType;
  event_version: "1";
  schema_version: "1.0";
  source: "kyqra-crawler";
  occurred_at: ISODateTime;
  tenant_id: string;
  correlation_id: string;
  job_id: UUID;
  idempotency_key: string;
  payload: TPayload;
}

export interface KyqraCrawlerSourceProfile {
  source_id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  crawl: {
    mode: "single" | "domain" | "list" | "discovery";
    schedule?: string | null;
    max_pages: number;
    max_depth: number;
    requests_per_second: number;
    respect_robots_txt: true;
    browser_mode: "auto" | "http" | "playwright";
  };
  discovery: {
    sitemap: boolean;
    rss: boolean;
    pagination: boolean;
  };
  extraction: {
    schema: string;
    schema_version: number;
  };
  allowed_content_types?: string[];
  privacy_policy: "public_business_only" | "authorized_private" | "restricted";
}
