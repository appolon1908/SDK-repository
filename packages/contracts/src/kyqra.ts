import type { ISODateTime, JsonObject, UUID } from "./index.js";

export type KyqraCrawlerEventType =
  | "codestra.crawler.job.completed"
  | "codestra.crawler.job.failed"
  | "codestra.crawler.result.review_required"
  | "codestra.crawler.job.progress";

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

export interface KyqraCrawlerEventPayload extends JsonObject {
  job_id: UUID;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "review_required";
  progress: KyqraCrawlerProgress;
  results: KyqraCrawlerResult[];
  error?: string | null;
}

export interface KyqraCrawlerEventEnvelope {
  event_id: string;
  event_type: KyqraCrawlerEventType;
  event_version: "1.0";
  occurred_at: ISODateTime;
  received_at: ISODateTime;
  source: "kyqra-gateway";
  tenant_id: string;
  customer_id?: string | null;
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: KyqraCrawlerEventPayload;
  metadata: JsonObject;
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
