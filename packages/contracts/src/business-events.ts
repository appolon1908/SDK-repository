/** Immutable business facts on the versioned codestra.<source>.events streams.
 * Existing CloudEvents types remain valid on their established streams.
 */
export interface BusinessEventEnvelope<TData = Record<string, unknown>> {
  readonly id: string;
  readonly type: string;
  readonly version: 1;
  readonly source: "klyrow" | "telnexa" | "vicidial" | "integration";
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly occurred_at: string;
  readonly data: TData;
}

/** Totals replace earlier daily projections; they are never additive charges. */
export interface KlyrowDailyUsage {
  readonly date: string;
  readonly unit: "accepted_message";
  readonly quantity: number;
  readonly snapshot_at: string;
}

export type KlyrowDailyUsageEvent = BusinessEventEnvelope<KlyrowDailyUsage> & {
  readonly source: "klyrow";
  readonly type: "klyrow.usage.daily";
};
