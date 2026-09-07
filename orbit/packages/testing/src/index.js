
export const ORBIT_REQUIRED_VIEWPORTS = Object.freeze([320, 360, 390, 768, 1024, 1280, 1440, 1920]);
export const ORBIT_GATE_NAMES = Object.freeze([
  'ORBIT_TOKENS','MONOCHROME_POLICY','TYPOGRAPHY','SPACING','RADIUS_BORDER_SHADOW','ORIGINALITY_NO_THIRD_PARTY_BRAND',
  'SHARED_HEADER','SHARED_FOOTER','SOCIAL_FOOTER_API','SOCIAL_URL_VALIDATION','AUTH_SHELL','AUTH_REDIRECT_SAFETY',
  'CONTENT_API','ASSET_API','PAGE_SCHEMA','ROUTE_MANIFEST','RESPONSIVE','ACCESSIBILITY','LOCALIZATION','SEO','ANALYTICS',
  'SECURITY','PERFORMANCE','VISUAL_REGRESSION','API_CONTRACT','AUDIT','ROLLBACK','CI_ENFORCEMENT'
]);

export function auditOrbitDocument(documentRef) {
  const violations = [];
  if (!documentRef?.querySelector) return [{code: 'NO_DOCUMENT', message: 'A rendered document is required.'}];
  if (!documentRef.querySelector('[data-orbit-component="header"]')) violations.push({code: 'MISSING_SHARED_HEADER', message: 'Shared Orbit header not found.'});
  if (!documentRef.querySelector('[data-orbit-component="footer"]')) violations.push({code: 'MISSING_SHARED_FOOTER', message: 'Shared Orbit footer not found.'});
  if (!documentRef.querySelector('main')) violations.push({code: 'MISSING_MAIN', message: 'Page requires one main landmark.'});
  for (const link of documentRef.querySelectorAll('a[target="_blank"]')) {
    const rel = new Set(String(link.rel || '').split(/\s+/));
    if (!rel.has('noopener') || !rel.has('noreferrer')) violations.push({code: 'UNSAFE_EXTERNAL_LINK', message: 'External links require noopener noreferrer.'});
  }
  for (const image of documentRef.querySelectorAll('img')) {
    if (!image.hasAttribute('alt')) violations.push({code: 'MISSING_ALT', message: 'Every image requires an alt attribute.'});
  }
  return violations;
}

export function validateRouteManifest(manifest) {
  const errors = [];
  if (!manifest || !Array.isArray(manifest.routes)) return ['routes must be an array'];
  const seen = new Set();
  for (const route of manifest.routes) {
    if (typeof route.path !== 'string' || !route.path.startsWith('/')) errors.push('each route requires an absolute path');
    if (seen.has(route.path)) errors.push(`duplicate route: ${route.path}`);
    seen.add(route.path);
    if (!['public','optional','required','operator'].includes(route.auth)) errors.push(`invalid auth classification: ${route.path}`);
    if (!route.shell || !route.footer) errors.push(`route missing shell/footer variant: ${route.path}`);
  }
  return errors;
}

export function scanSourceForOrbitViolations(source) {
  const text = String(source || '');
  const findings = [];
  if (/(localStorage|sessionStorage)\s*\.\s*(setItem|getItem)\s*\(\s*['"][^'"]*(access|refresh|id[_-]?token|jwt)/i.test(text)) findings.push('TOKEN_WEB_STORAGE');
  if (/\b(?:bg|text|border)-\[#[0-9a-f]{3,8}\]/i.test(text) || /#[0-9a-f]{6}\b/i.test(text)) findings.push('RAW_COLOR');
  if (/linear-gradient\(|radial-gradient\(|backdrop-filter\s*:/i.test(text)) findings.push('PROHIBITED_VISUAL_EFFECT');
  return findings;
}
