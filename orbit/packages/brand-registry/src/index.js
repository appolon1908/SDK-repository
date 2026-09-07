import registrySource from '../registry/brand-registry.json' with { type: 'json' };

export const ORBIT_VERSION = '2.0.0';
export const CODESTRA_FOOTER_ATTRIBUTION = registrySource.footerAttribution;
export const CODESTRA_IDENTITY = deepFreeze(structuredClone(registrySource.identity));
export const CODESTRA_DOMAIN_RECORDS = deepFreeze(structuredClone(registrySource.domains));
export const CODESTRA_SOCIAL_HOSTS = Object.freeze({
  linkedin: ['linkedin.com', 'www.linkedin.com'],
  facebook: ['facebook.com', 'www.facebook.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be'],
  github: ['github.com', 'www.github.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
  threads: ['threads.net', 'www.threads.net'],
});

const LOCALHOST = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeHttpsOrigin(value, { allowLocalhost = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const local = LOCALHOST.has(url.hostname);
  if (url.protocol !== 'https:' && !(allowLocalhost && local && url.protocol === 'http:')) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

export function isRegisteredCodestraHost(hostname) {
  if (typeof hostname !== 'string') return false;
  const host = hostname.trim().toLowerCase();
  return CODESTRA_DOMAIN_RECORDS.some((record) => record.host === host && record.status === 'registered');
}

export function resolveDomainRecord(hostname) {
  if (typeof hostname !== 'string') return null;
  const host = hostname.trim().toLowerCase();
  return CODESTRA_DOMAIN_RECORDS.find((record) => record.host === host) ?? null;
}

export function suiteHostname(application, environment = 'production', pullRequest) {
  const slug = String(application ?? '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    throw new TypeError('application must be a valid DNS label');
  }
  if (environment === 'production') return `${slug}.codestra.co`;
  if (environment === 'staging') return `${slug}.staging.codestra.co`;
  if (environment === 'preview') {
    const pr = Number(pullRequest);
    if (!Number.isSafeInteger(pr) || pr < 1) throw new TypeError('preview requires a positive pull request number');
    return `pr-${pr}.${slug}.preview.codestra.co`;
  }
  throw new TypeError('environment must be production, staging, or preview');
}

export function validateSocialUrl(network, value) {
  const allowed = CODESTRA_SOCIAL_HOSTS[String(network ?? '').toLowerCase()];
  if (!allowed || typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && allowed.includes(url.hostname.toLowerCase());
}

export function validateReturnUrl(value, { currentOrigin, allowedOrigins = [] } = {}) {
  const origin = normalizeHttpsOrigin(currentOrigin, { allowLocalhost: true }) ??
    (typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : null);
  if (!origin || typeof value !== 'string' || value.trim() === '') return null;
  let url;
  try { url = new URL(value, origin); } catch { return null; }
  const normalizedAllowed = new Set([origin, ...allowedOrigins.map((item) => normalizeHttpsOrigin(item, { allowLocalhost: true })).filter(Boolean)]);
  if (!normalizedAllowed.has(url.origin) || url.username || url.password) return null;
  if (url.origin === origin) return `${url.pathname}${url.search}${url.hash}`;
  return url.toString();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
