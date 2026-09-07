import type { JsonObject } from "@codestra/contracts";

export type CanonicalOperationState =
  | "RECEIVED"
  | "QUEUED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "UNKNOWN"
  | "COMPLETED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED"
  | "DEAD_LETTERED"
  | "CANCELLED";

export interface CanonicalCommandInput {
  commandType: string;
  target: string;
  capability: string;
  payload: JsonObject;
  commandId?: string;
}

export interface CanonicalCommandEnvelope {
  command_id: string;
  command_type: string;
  command_version: "1.0";
  target: string;
  tenant_id: string;
  requested_by: string;
  correlation_id: string;
  idempotency_key: string;
  capability: string;
  payload: JsonObject;
}

export interface OperationListOptions {
  cursor?: string;
  limit?: number;
  state?: CanonicalOperationState;
  command_type?: string;
  signal?: AbortSignal;
  correlationId?: string;
}

export interface OperationMutationInput {
  expected_version: number;
  reason: string;
}

export type GenerateAiTask = "copy" | "classify" | "summarize" | "score" | "creative_brief";
export type GenerateAiDataClass = "public" | "internal" | "confidential";

export interface GenerateAiInput {
  task: GenerateAiTask;
  input: string;
  tenant_id?: string | null;
  campaign_id?: string | null;
  data_class?: GenerateAiDataClass;
  region?: string;
  maximum_cost_micros?: number;
  retain_output?: boolean;
}

export interface TriggerAutomationCommandInput {
  workflowKey: string;
  workflowFamily?: string;
  workflowVersion?: string;
  payload?: JsonObject;
  commandId?: string;
}
