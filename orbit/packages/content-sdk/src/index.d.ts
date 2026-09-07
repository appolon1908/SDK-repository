export interface OrbitMutationOptions {
  idempotencyKey: string;
  expectedVersion: number;
  reason: string;
  body?: unknown;
}

export interface OrbitContentClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export declare class ContentRequestError extends Error {
  status: number;
  correlationId: string;
}

export declare function createContentClient(
  options?: OrbitContentClientOptions,
): Readonly<Record<string, Function>>;

export declare function getShellBundle(
  client: Record<string, Function>,
  brand: string,
  application: string,
): Promise<Readonly<Record<string, unknown>>>;

export declare const orbitContentVersion: string;
