/**
 * Privy catches SIWS failures inside its modal and does not return them
 * from login(). Record HTTP status and a short code only.
 */

const PRIVY_AUTH_ORIGIN = 'https://auth.privy.io';
const SIWS_POSTS = Object.freeze({
  '/api/v1/siws/init': 'siws/init',
  '/api/v1/siws/authenticate': 'siws/authenticate',
});
const SAFE_CODE = /^[a-z0-9_]{1,64}$/;
const FAILURE = 'siws_failed';

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

function requestMethod(input, init) {
  const method = init?.method || input?.method || 'GET';
  return String(method).toUpperCase();
}

function safeToken(value) {
  if (typeof value !== 'string') return '';
  const code = value.trim();
  return SAFE_CODE.test(code) ? code : '';
}

/** `siws/init` or `siws/authenticate` for a Privy SIWS POST, otherwise ''. */
export function siwsPostName(input, init) {
  if (requestMethod(input, init) !== 'POST') return '';
  const raw = requestUrl(input);
  if (!raw || raw.startsWith('/')) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if (parsed.origin !== PRIVY_AUTH_ORIGIN) return '';
  return SIWS_POSTS[parsed.pathname] || '';
}

/** Short code from `code`, else `error`, else `siws_failed`. Sentences and secrets are dropped. */
export function safeSiwsCode(body) {
  if (!body || typeof body !== 'object') return FAILURE;
  return safeToken(body.code) || safeToken(body.error) || FAILURE;
}

export function walletLoginFailureLine(name, status, code) {
  const statusText = Number.isInteger(status) ? String(status) : 'network';
  return `[wallet-login] ${name} ${statusText} ${safeToken(code) || FAILURE}`;
}

async function lineFromResponse(name, response) {
  let code = FAILURE;
  if (response && typeof response.clone === 'function') {
    try {
      code = safeSiwsCode(await response.clone().json());
    } catch {
      code = FAILURE;
    }
  }
  return walletLoginFailureLine(name, response?.status, code);
}

function report(log, line) {
  try {
    log(line);
  } catch {
    /* a diagnostic must not block login */
  }
}

/**
 * Wrap fetch once. Successful SIWS responses are not read.
 * @param {typeof globalThis} [target]
 * @param {(line: string) => void} [log]
 */
export function installSiwsLoginDiagnostic(target = globalThis, log = console.warn) {
  if (!target || typeof target.fetch !== 'function') return null;
  if (target.__maelstromSiwsLoginDiagnostic) return target.__maelstromSiwsLoginDiagnostic;
  const original = target.fetch.bind(target);
  const write = typeof log === 'function' ? log : console.warn;
  const hooked = async (input, init) => {
    const name = siwsPostName(input, init);
    if (!name) return original(input, init);
    let response;
    try {
      response = await original(input, init);
    } catch (error) {
      report(write, walletLoginFailureLine(name, 'network', FAILURE));
      throw error;
    }
    if (response && response.ok === false) {
      report(write, await lineFromResponse(name, response));
    }
    return response;
  };
  target.fetch = hooked;
  const handle = { installed: true };
  Object.defineProperty(target, '__maelstromSiwsLoginDiagnostic', {
    value: handle,
    configurable: true,
  });
  return handle;
}
