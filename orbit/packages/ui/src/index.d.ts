export type OrbitFooterVariant = 'full' | 'compact' | 'auth-compact' | 'legal-only';
export type OrbitSocialNetwork = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'youtube' | 'github' | 'tiktok' | 'threads';

export interface OrbitNavigationItem {
  label?: string;
  resolvedLabel?: string;
  labelKey?: string;
  href: string;
  current?: boolean;
}

export interface OrbitSession {
  authenticated: boolean;
  displayName?: string;
}

export interface OrbitSocialItem {
  network: OrbitSocialNetwork;
  url: string;
  enabled: boolean;
  validated: boolean;
  label?: string;
}

export interface OrbitFooterResource {
  brand: string;
  revision: number;
  expectedVersion: number;
  attribution: 'Powered by Codestra.co';
  published: boolean;
  links: OrbitNavigationItem[];
  social: OrbitSocialItem[];
}

export declare function createOrbitHeader(options?: Record<string, unknown>): HTMLElement;
export declare function createOrbitFooter(options?: {
  documentRef?: Document;
  resource?: OrbitFooterResource;
  brand?: string;
  links?: OrbitNavigationItem[];
  social?: OrbitSocialItem[];
  published?: boolean;
  allowedOrigins?: string[];
  attribution?: string;
  variant?: OrbitFooterVariant;
  year?: number;
}): HTMLElement;
export declare function createOrbitAuthShell(options?: Record<string, unknown>): HTMLElement;
export declare function mountOrbitPage(options: Record<string, unknown>): {root: HTMLElement; unmount: () => void};
export declare const orbitFooterVariants: readonly OrbitFooterVariant[];
export declare const orbitSocialNetworks: readonly OrbitSocialNetwork[];
export declare const orbitUiVersion: string;
