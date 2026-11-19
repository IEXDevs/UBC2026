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

/** Fired on `target` when a SIWS post fails. `detail` is the safe log line. */
export const WALLET_LOGIN_EVENT = 'maelstrom:wallet-login-failure';

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

function report(target, log, line) {
  try {
    log(line);
  } catch {
    /* a diagnostic must not block login */
  }
  const EventCtor = target?.CustomEvent;
  if (typeof target?.dispatchEvent !== 'function' || typeof EventCtor !== 'function') return;
  try {
    target.dispatchEvent(new EventCtor(WALLET_LOGIN_EVENT, { detail: line }));
  } catch {
    /* a diagnostic must not block login */
  }
}

/**
 * One sentence for the sign-in card. Unknown lines return ''.
 * The line is the diagnostic's safe form, never a response body.
 */
export function walletLoginFailureNote(line) {
  if (typeof line !== 'string') return '';
  const match = line.match(/^\[wallet-login\] \S+ (\S+) (\S+)$/);
  if (!match) return '';
  const status = match[1];
  const code = match[2];
  if (code === 'invalid_data') {
    return 'That signature did not match this site. Disconnect the site in your wallet, then try again.';
  }
  if (code === 'disallowed_login_method') return 'Wallet sign-in is turned off for this Privy app.';
  if (code === 'linked_to_another_user') return 'That wallet is already on another account.';
  if (code === 'captcha_timeout' || code === 'captcha_failed') return 'The sign-in check did not finish. Try again.';
  if (status === 'network') return 'The wallet sign-in request did not reach Privy.';
  if (code === FAILURE) return 'Wallet sign-in did not complete. Try connecting again.';
  return `Wallet sign-in failed (${code}).`;
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
      report(target, write, walletLoginFailureLine(name, 'network', FAILURE));
      throw error;
    }
    if (response && response.ok === false) {
      report(target, write, await lineFromResponse(name, response));
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
