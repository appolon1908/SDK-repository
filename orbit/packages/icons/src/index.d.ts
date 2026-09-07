
export type OrbitIconName = 'menu'|'close'|'account'|'logout'|'arrowRight'|'external'|'check'|'alert'|'social';
export declare const ORBIT_ICON_PATHS: Readonly<Record<OrbitIconName, readonly string[]>>;
export declare function createOrbitIcon(name: OrbitIconName, options?: {documentRef?: Document; size?: number; title?: string}): SVGSVGElement;
