
export interface DomainRecord { host: string; purpose: string; status: string; canonical: boolean }
export declare const ORBIT_VERSION: string;
export declare const CODESTRA_FOOTER_ATTRIBUTION: string;
export declare const CODESTRA_IDENTITY: Readonly<Record<string, string>>;
export declare const CODESTRA_DOMAIN_RECORDS: readonly DomainRecord[];
export declare const CODESTRA_SOCIAL_HOSTS: Readonly<Record<string, readonly string[]>>;
export declare function normalizeHttpsOrigin(value: string, options?: {allowLocalhost?: boolean}): string | null;
export declare function isRegisteredCodestraHost(hostname: string): boolean;
export declare function resolveDomainRecord(hostname: string): DomainRecord | null;
export declare function suiteHostname(application: string, environment?: 'production'|'staging'|'preview', pullRequest?: number): string;
export declare function validateSocialUrl(network: string, value: string): boolean;
export declare function validateReturnUrl(value: string, options?: {currentOrigin?: string; allowedOrigins?: string[]}): string | null;
