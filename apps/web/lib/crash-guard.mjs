/**
 * Production crash overlay. Only real app render/runtime failures should
 * replace the desk with the 404 screen. Privy, Turnstile, Wallet Standard,
 * and extension noise must not.
 */

const EXTENSION = /chrome-extension:|moz-extension:/i;
const RESIZE_OBSERVER = /ResizeObserver loop/i;
const THIRD_PARTY = /privy|turnstile|hcaptcha|wallet-standard|no available adapters|unable to refresh tokens|iframe failed|exceeded max attempts|trustedscript|function constructor|embedded-wallets|privy-auth|authenticating session|challenges\.cloudflare|auth\.privy\.io|connect-src|data:,/i;

export function fromThisApp(file, origin) {
  if (typeof file !== 'string' || file === '' || typeof origin !== 'string' || !origin) return false;
  try {
    return new URL(file, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function rejectionText(reason) {
  if (reason == null) return '';
  if (typeof reason === 'string') return reason;
  if (typeof reason !== 'object') return String(reason);
  const name = typeof reason.name === 'string' ? reason.name : '';
  const message = typeof reason.message === 'string' ? reason.message : '';
  const stack = typeof reason.stack === 'string' ? reason.stack : '';
  return `${name}\n${message}\n${stack}`;
}

export function isIgnorableAuthFailure(text) {
  return THIRD_PARTY.test(String(text || ''));
}

export function stackHasAppFrame(stack, origin) {
  if (typeof stack !== 'string' || !stack || typeof origin !== 'string' || !origin) return false;
  return stack.includes(origin);
}

export function shouldCrashOnError({ message = '', filename = '', origin = '' } = {}) {
  const text = `${message}\n${filename}`;
  if (RESIZE_OBSERVER.test(String(message || ''))) return false;
  if (isIgnorableAuthFailure(text)) return false;
  return fromThisApp(filename, origin);
}

export function shouldCrashOnRejection(reason, { origin = '' } = {}) {
  const text = rejectionText(reason);
  if (isIgnorableAuthFailure(text)) return false;
  const stack = typeof reason?.stack === 'string' ? reason.stack : '';
  if (EXTENSION.test(stack) || EXTENSION.test(text)) return false;
  return stackHasAppFrame(stack, origin);
}
