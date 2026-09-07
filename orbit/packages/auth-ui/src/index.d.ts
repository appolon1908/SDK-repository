
export interface OrbitSession { authenticated: boolean; user?: Record<string, unknown>; tenant?: Record<string, unknown>; roles?: string[]; capabilities?: string[]; expiresAt?: string }
export declare class AuthRequestError extends Error { code: string; status: number; correlationId: string }
export declare function safeRedirectTarget(value: string, options?: {currentOrigin?: string; allowedOrigins?: string[]; fallback?: string}): string;
export declare function createSessionClient(options?: Record<string, unknown>): Readonly<Record<string, Function>>;
export declare function requireSession(client: Record<string, Function>, options?: Record<string, unknown>): Promise<OrbitSession|null>;
export declare const orbitAuthVersion: string;
