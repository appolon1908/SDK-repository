
export declare const ORBIT_REQUIRED_VIEWPORTS: readonly number[];
export declare const ORBIT_GATE_NAMES: readonly string[];
export declare function auditOrbitDocument(documentRef: Document): Array<{code:string; message:string}>;
export declare function validateRouteManifest(manifest: Record<string, unknown>): string[];
export declare function scanSourceForOrbitViolations(source: string): string[];
