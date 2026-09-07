
const DEFAULT_BASE_PATH = '/auth';
const EVENT_CHANNEL = 'codestra:auth';
const EVENT_STORAGE_KEY = 'codestra:auth:event';
const FALLBACK_RETURN = '/app';

function correlationId() {
  return globalThis.crypto?.randomUUID?.() ?? `orbit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeBasePath(value) {
  const path = String(value || DEFAULT_BASE_PATH).trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) throw new TypeError('basePath must be a same-origin absolute path');
  return path.replace(/\/$/, '');
}

export function safeRedirectTarget(value, { currentOrigin = globalThis.location?.origin, allowedOrigins = [], fallback = FALLBACK_RETURN } = {}) {
  if (!currentOrigin) return fallback;
  let current;
  try { current = new URL(currentOrigin); } catch { return fallback; }
  let url;
  try { url = new URL(String(value || fallback), current); } catch { return fallback; }
  if (url.username || url.password) return fallback;
  const allowed = new Set([current.origin]);
  for (const candidate of allowedOrigins) {
    let origin;
    try { origin = new URL(String(candidate)); } catch { continue; }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.username || origin.password || (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))) continue;
    allowed.add(origin.origin);
  }
  if (!allowed.has(url.origin)) return fallback;
  return url.origin === current.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

export class AuthRequestError extends Error {
  constructor(code, status, correlation) {
    super('The account request could not be completed.');
    this.name = 'AuthRequestError';
    this.code = code;
    this.status = status;
    this.correlationId = correlation;
  }
}

function createEventBridge(onEvent) {
  let channel = null;
  const onStorage = (event) => {
    if (event.key !== EVENT_STORAGE_KEY || !event.newValue) return;
    try { onEvent(JSON.parse(event.newValue)); } catch { /* ignore malformed non-sensitive events */ }
  };
  if (typeof globalThis.BroadcastChannel === 'function') {
    channel = new globalThis.BroadcastChannel(EVENT_CHANNEL);
    channel.addEventListener('message', (event) => onEvent(event.data));
  }
  globalThis.addEventListener?.('storage', onStorage);
  return {
    publish(event) {
      channel?.postMessage(event);
      try { globalThis.localStorage?.setItem(EVENT_STORAGE_KEY, JSON.stringify(event)); }
      catch { /* BroadcastChannel and same-tab listeners still work */ }
      onEvent(event);
    },
    close() { channel?.close(); globalThis.removeEventListener?.('storage', onStorage); }
  };
}

export function createSessionClient({
  basePath = DEFAULT_BASE_PATH,
  fetchImpl = globalThis.fetch,
  locationRef = globalThis.location,
  csrfTokenProvider,
  allowedReturnOrigins = []
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  const base = normalizeBasePath(basePath);
  const subscribers = new Set();
  const mutations = new Map();
  let mutationTail = Promise.resolve();
  const bridge = createEventBridge((event) => {
    for (const subscriber of subscribers) subscriber(event);
  });

  async function request(path, { method = 'GET', body, mutationName } = {}) {
    if (mutationName && mutations.has(mutationName)) return mutations.get(mutationName);
    const id = correlationId();
    const headers = { 'Accept': 'application/json', 'X-Correlation-ID': id };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') {
      const token = await csrfTokenProvider?.();
      if (token) headers['X-CSRF-Token'] = String(token);
    }
    const execute = async () => {
      let response;
      try {
        response = await fetchImpl(`${base}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: 'include',
          cache: 'no-store',
          redirect: 'manual'
        });
      } catch {
        throw new AuthRequestError('network_error', 0, id);
      }
      if (!response.ok) throw new AuthRequestError('request_rejected', response.status, response.headers.get('x-correlation-id') || id);
      if (response.status === 204) return null;
      const contentType = response.headers.get('content-type') || '';
      return contentType.includes('application/json') ? response.json() : null;
    };
    if (!mutationName) return execute();
    const operation = mutationTail.catch(() => undefined).then(execute);
    const tracked = operation.finally(() => { mutations.delete(mutationName); });
    mutations.set(mutationName, tracked);
    mutationTail = tracked;
    return tracked;
  }

  function redirect(path, returnTo) {
    const normalized = safeRedirectTarget(returnTo, { currentOrigin: locationRef?.origin, allowedOrigins: allowedReturnOrigins });
    const target = `${base}${path}?return_to=${encodeURIComponent(normalized)}`;
    locationRef?.assign?.(target);
    return target;
  }

  return Object.freeze({
    async getSession() { return request('/session'); },
    beginLogin(options = {}) { return redirect('/login', options.returnTo); },
    beginSignup(options = {}) { return redirect('/signup', options.returnTo); },
    async refresh() { return request('/refresh', { method: 'POST', mutationName: 'refresh' }); },
    async logout({ returnTo = '/signed-out' } = {}) {
      await request('/logout', { method: 'POST', mutationName: 'logout' });
      bridge.publish({ type: 'signed-out', at: new Date().toISOString(), nonce: correlationId() });
      const target = safeRedirectTarget(returnTo, { currentOrigin: locationRef?.origin, allowedOrigins: allowedReturnOrigins, fallback: '/signed-out' });
      locationRef?.assign?.(target);
      return target;
    },
    async logoutAll({ returnTo = '/signed-out' } = {}) {
      await request('/logout-all', { method: 'POST', mutationName: 'logout-all' });
      bridge.publish({ type: 'signed-out-all', at: new Date().toISOString(), nonce: correlationId() });
      const target = safeRedirectTarget(returnTo, { currentOrigin: locationRef?.origin, allowedOrigins: allowedReturnOrigins, fallback: '/signed-out' });
      locationRef?.assign?.(target);
      return target;
    },
    subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('listener must be a function'); subscribers.add(listener); return () => subscribers.delete(listener); },
    close() { bridge.close(); subscribers.clear(); }
  });
}

export async function requireSession(client, { returnTo = globalThis.location?.href, onAuthenticated } = {}) {
  try {
    const session = await client.getSession();
    if (session?.authenticated) { await onAuthenticated?.(session); return session; }
  } catch (error) {
    if (!(error instanceof AuthRequestError) || ![401, 403].includes(error.status)) throw error;
  }
  client.beginLogin({ returnTo });
  return null;
}

export const orbitAuthVersion = '2.0.0';
