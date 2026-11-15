/**
 * Privy's login icons pass SVG attributes as hyphenated JSX props
 * (`fill-rule`, `clip-rule`). React warns on those names. The published
 * package is already at the latest 3.x and still emits them, so rewrite the
 * installed bundle to the camelCase props React expects.
 *
 * The DOM output stays `fill-rule` / `clip-rule`. Only the React prop keys change.
 *
 * The same pass drops two login-console warnings that are not failures:
 * Privy logs AbortError when React Strict Mode cancels the first app-config
 * fetch, and Turnstile warns when Privy calls execute() on a render-mode widget.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SVG_PROP_REWRITES = Object.freeze([
  [/"fill-rule"\s*:/g, 'fillRule:'],
  [/"clip-rule"\s*:/g, 'clipRule:'],
]);

const APP_CONFIG_WARN = 'p(t),console.warn("Error generating app config: ",t)';
const APP_CONFIG_WARN_FIXED = 'p(t);if(t.name!=="AbortError")console.warn("Error generating app config: ",t)';

const TURNSTILE_EXECUTE_WARN = 'console.warn(`Execution mode is not set to "execute"`)';

/**
 * After the email code is accepted, Privy shows "Success!" and then routes to
 * the terms screen or embedded-wallet creation. Those routes keep the modal
 * open, so the signed-in shell never appears. Close the modal on that success
 * instead. Wallet provisioning stays on the app's own API.
 */
const PASSWORDLESS_SUCCESS_CLOSE = Object.freeze([
  [
    'if(w&&I&&_){if(s?.legal.requireUsersAcceptTerms&&!_.hasAcceptedTerms){let e=setTimeout((()=>{r("AffirmativeConsentScreen")}),B);return()=>clearTimeout(e)}if(E(_,s.embeddedWallets)){let e=setTimeout((()=>{a({createWallet:{onSuccess:()=>{},onFailure:e=>{console.error(e),T({eventName:"embedded_wallet_creation_failure_logout",payload:{error:e,screen:"AwaitingPasswordlessCodeScreen"}}),N()},callAuthOnSuccessOnClose:!0}}),r("EmbeddedWalletOnAccountCreateScreen")}),B);return()=>clearTimeout(e)}{A();let e=setTimeout((()=>l({shouldCallAuthOnSuccess:!0,isSuccess:!0})),f);return()=>clearTimeout(e)}}',
    'if(w&&I&&_){A(),l({shouldCallAuthOnSuccess:!0,isSuccess:!0})}',
  ],
  [
    'if(g&&b&&S){if(s?.legal.requireUsersAcceptTerms&&!S.hasAcceptedTerms){let e=setTimeout((()=>{r("AffirmativeConsentScreen")}),M);return()=>clearTimeout(e)}if(p.shouldProceedtoEmbeddedWalletCreationFlow(S,s.embeddedWallets)){let e=setTimeout((()=>{n({createWallet:{onSuccess:()=>{},onFailure:e=>{console.error(e),x({eventName:"embedded_wallet_creation_failure_logout",payload:{error:e,screen:"AwaitingPasswordlessCodeScreen"}}),C()},callAuthOnSuccessOnClose:!0}}),r("EmbeddedWalletOnAccountCreateScreen")}),M);return()=>clearTimeout(e)}{E();let e=setTimeout((()=>l({shouldCallAuthOnSuccess:!0,isSuccess:!0})),c.DEFAULT_SUCCESS_SCREEN_DURATION_MS);return()=>clearTimeout(e)}}',
    'if(g&&b&&S){E(),l({shouldCallAuthOnSuccess:!0,isSuccess:!0})}',
  ],
]);

/** Same for OAuth: do not stall on AffirmativeConsent / embedded-wallet screens. */
const OAUTH_SUCCESS_CLOSE = Object.freeze([
  [
    'o((()=>{if(l&&t&&b&&d){if(h?.legal.requireUsersAcceptTerms&&!d.hasAcceptedTerms){let e=setTimeout((()=>{u("AffirmativeConsentScreen")}),c);return()=>clearTimeout(e)}if(C(d,h.embeddedWallets)){let e=setTimeout((()=>{m({createWallet:{onSuccess:()=>{},onFailure:e=>{console.error(e),A({eventName:"embedded_wallet_creation_failure_logout",payload:{error:e,provider:L,screen:"OAuthStatusScreen"}}),a()},callAuthOnSuccessOnClose:!0}}),u("EmbeddedWalletOnAccountCreateScreen")}),c);return()=>clearTimeout(e)}{let e=setTimeout((()=>T({shouldCallAuthOnSuccess:!0,isSuccess:!0})),c);return v(),()=>clearTimeout(e)}}}),[l,t,b,d])',
    'o((()=>{if(l&&t&&b&&d){v(),T({shouldCallAuthOnSuccess:!0,isSuccess:!0})}}),[l,t,b,d])',
  ],
]);

export function closePasswordlessLoginModal(source) {
  let next = String(source);
  for (const [from, to] of PASSWORDLESS_SUCCESS_CLOSE) {
    next = next.replaceAll(from, to);
  }
  return next;
}

export function closeOAuthLoginModal(source) {
  let next = String(source);
  for (const [from, to] of OAUTH_SUCCESS_CLOSE) {
    next = next.replaceAll(from, to);
  }
  return next;
}

export function rewriteSvgDomProps(source) {
  let next = String(source);
  for (const [pattern, replacement] of SVG_PROP_REWRITES) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, replacement);
  }
  return next.replaceAll(APP_CONFIG_WARN, APP_CONFIG_WARN_FIXED);
}

export function silenceTurnstileExecuteWarning(source) {
  return String(source).replaceAll(TURNSTILE_EXECUTE_WARN, 'void 0');
}

function walkJsFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return out;
    throw error;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      walkJsFiles(full, out);
      continue;
    }
    if (/\.(?:js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

function patchTree(dir, rewrite) {
  const files = walkJsFiles(dir, []);
  let patched = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const next = rewrite(source);
    if (next === source) continue;
    writeFileSync(file, next);
    patched += 1;
  }
  return { dir, scanned: files.length, patched };
}

export function patchPrivySvgProps(repoRoot) {
  const privy = patchTree(
    path.join(repoRoot, 'node_modules', '@privy-io', 'react-auth', 'dist'),
    (source) => closeOAuthLoginModal(closePasswordlessLoginModal(rewriteSvgDomProps(source))),
  );
  const turnstile = patchTree(
    path.join(repoRoot, 'node_modules', '@marsidev', 'react-turnstile'),
    silenceTurnstileExecuteWarning,
  );
  return {
    dist: privy.dir,
    scanned: privy.scanned + turnstile.scanned,
    patched: privy.patched + turnstile.patched,
    privy,
    turnstile,
  };
}

function isDirectRun() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = patchPrivySvgProps(repoRoot);
  if (result.scanned === 0) {
    console.log('patch-privy-svg-props: @privy-io/react-auth dist not installed, skipped');
  } else {
    console.log(`patch-privy-svg-props: rewrote ${result.patched} file(s)`);
  }
}
