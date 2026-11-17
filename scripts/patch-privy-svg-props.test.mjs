import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  closeOAuthLoginModal,
  closePasswordlessLoginModal,
  patchPrivySvgProps,
  rewriteSvgDomProps,
  silenceTurnstileExecuteWarning,
} from './patch-privy-svg-props.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: fill-rule/clip-rule become fillRule/clipRule; rewrite is idempotent.
 * Fails when: Hyphenated props remain or double-rewrite mutates further.
 * Oracle: React SVG DOM property names.
 * Side effects: none
 * Gaps: Does not cover every SVG hyphenated attribute.
 */
test('rewrites hyphenated svg props to React camelCase', () => {
  const source = 't("path",{"fill-rule":"evenodd","clip-rule":"evenodd",d:"M"})';
  assert.equal(
    rewriteSvgDomProps(source),
    't("path",{fillRule:"evenodd",clipRule:"evenodd",d:"M"})',
  );
  assert.equal(rewriteSvgDomProps(rewriteSvgDomProps(source)), rewriteSvgDomProps(source));
});

/**
 * Achieves: App-config console.warn remains; AbortError name guard is inserted; rewrite is idempotent.
 * Fails when: App-config warnings removed, or AbortError still warns.
 * Oracle: Privy react-auth bundle patch contract.
 * Side effects: none
 * Gaps: Depends on minified catch-shape continuing to match.
 */
test('keeps Privy app-config failures and skips the strict-mode abort warning', () => {
  const source = 'catch(e){let t=e instanceof Error?e:Error(String(e));p(t),console.warn("Error generating app config: ",t)}';
  const next = rewriteSvgDomProps(source);
  assert.equal(next.includes('console.warn("Error generating app config: ",t)'), true);
  assert.match(next, /t\.name!=="AbortError"/);
  assert.equal(rewriteSvgDomProps(next), next);
});

/**
 * Achieves: Passwordless success collapses to delayed auth-success close for ESM/CJS; terms/wallet screens removed; idempotent.
 * Fails when: Terms/wallet screens remain, or success close becomes synchronous-only without delay.
 * Oracle: Privy login modal success UX patch.
 * Side effects: none
 * Gaps: Fragile to upstream Privy minified identifier churn.
 */
test('email-code success skips terms/wallet screens but keeps delayed modal close', () => {
  const esm = 'if(w&&I&&_){if(s?.legal.requireUsersAcceptTerms&&!_.hasAcceptedTerms){let e=setTimeout((()=>{r("AffirmativeConsentScreen")}),B);return()=>clearTimeout(e)}if(E(_,s.embeddedWallets)){let e=setTimeout((()=>{a({createWallet:{onSuccess:()=>{},onFailure:e=>{console.error(e),T({eventName:"embedded_wallet_creation_failure_logout",payload:{error:e,screen:"AwaitingPasswordlessCodeScreen"}}),N()},callAuthOnSuccessOnClose:!0}}),r("EmbeddedWalletOnAccountCreateScreen")}),B);return()=>clearTimeout(e)}{A();let e=setTimeout((()=>l({shouldCallAuthOnSuccess:!0,isSuccess:!0})),f);return()=>clearTimeout(e)}}';
  const cjs = 'if(g&&b&&S){if(s?.legal.requireUsersAcceptTerms&&!S.hasAcceptedTerms){let e=setTimeout((()=>{r("AffirmativeConsentScreen")}),M);return()=>clearTimeout(e)}if(p.shouldProceedtoEmbeddedWalletCreationFlow(S,s.embeddedWallets)){let e=setTimeout((()=>{n({createWallet:{onSuccess:()=>{},onFailure:e=>{console.error(e),x({eventName:"embedded_wallet_creation_failure_logout",payload:{error:e,screen:"AwaitingPasswordlessCodeScreen"}}),C()},callAuthOnSuccessOnClose:!0}}),r("EmbeddedWalletOnAccountCreateScreen")}),M);return()=>clearTimeout(e)}{E();let e=setTimeout((()=>l({shouldCallAuthOnSuccess:!0,isSuccess:!0})),c.DEFAULT_SUCCESS_SCREEN_DURATION_MS);return()=>clearTimeout(e)}}';
  const expectedEsm = 'if(w&&I&&_){A();let e=setTimeout((()=>l({shouldCallAuthOnSuccess:!0,isSuccess:!0})),f);return()=>clearTimeout(e)}';
  const expectedCjs = 'if(g&&b&&S){E();let e=setTimeout((()=>l({shouldCallAuthOnSuccess:!0,isSuccess:!0})),c.DEFAULT_SUCCESS_SCREEN_DURATION_MS);return()=>clearTimeout(e)}';
  const esmNext = closePasswordlessLoginModal(esm);
  const cjsNext = closePasswordlessLoginModal(cjs);
  assert.equal(esmNext, expectedEsm);
  assert.equal(cjsNext, expectedCjs);
  assert.equal(esmNext.includes('AffirmativeConsentScreen'), false);
  assert.equal(cjsNext.includes('EmbeddedWalletOnAccountCreateScreen'), false);
  assert.equal(closePasswordlessLoginModal(esmNext), esmNext);
  assert.equal(closePasswordlessLoginModal(cjsNext), cjsNext);
  assert.equal(
    closePasswordlessLoginModal('if(w&&I&&_){A(),l({shouldCallAuthOnSuccess:!0,isSuccess:!0})}'),
    expectedEsm,
  );
});

/**
 * Achieves: OAuth success path keeps delayed close + cleanup; terms/wallet screens removed; idempotent.
 * Fails when: OAuth still routes to AffirmativeConsentScreen.
 * Oracle: Privy OAuth status screen patch.
 * Side effects: none
 * Gaps: Fragile to upstream Privy minified identifier churn.
 */
test('OAuth success skips terms/wallet screens but keeps delayed modal close', () => {
  const esm = 'o((()=>{if(l&&t&&b&&d){if(h?.legal.requireUsersAcceptTerms&&!d.hasAcceptedTerms){let e=setTimeout((()=>{u("AffirmativeConsentScreen")}),c);return()=>clearTimeout(e)}if(C(d,h.embeddedWallets)){let e=setTimeout((()=>{m({createWallet:{onSuccess:()=>{},onFailure:e=>{console.error(e),A({eventName:"embedded_wallet_creation_failure_logout",payload:{error:e,provider:L,screen:"OAuthStatusScreen"}}),a()},callAuthOnSuccessOnClose:!0}}),u("EmbeddedWalletOnAccountCreateScreen")}),c);return()=>clearTimeout(e)}{let e=setTimeout((()=>T({shouldCallAuthOnSuccess:!0,isSuccess:!0})),c);return v(),()=>clearTimeout(e)}}}),[l,t,b,d])';
  const expected = 'o((()=>{if(l&&t&&b&&d){let e=setTimeout((()=>T({shouldCallAuthOnSuccess:!0,isSuccess:!0})),c);return v(),()=>clearTimeout(e)}}),[l,t,b,d])';
  const next = closeOAuthLoginModal(esm);
  assert.equal(next, expected);
  assert.equal(next.includes('AffirmativeConsentScreen'), false);
  assert.equal(closeOAuthLoginModal(next), next);
  assert.equal(
    closeOAuthLoginModal('o((()=>{if(l&&t&&b&&d){v(),T({shouldCallAuthOnSuccess:!0,isSuccess:!0})}}),[l,t,b,d])'),
    expected,
  );
});

/**
 * Achieves: silenceTurnstileExecuteWarning removes the execute-mode console.warn; idempotent.
 * Fails when: Warning string remains.
 * Oracle: @marsidev/react-turnstile patch contract.
 * Side effects: none
 * Gaps: none meaningful
 */
test('drops the Turnstile execute-mode warning', () => {
  const source = 'd.execution===`execute`?e.execute(z.current):console.warn(`Execution mode is not set to "execute"`)';
  const next = silenceTurnstileExecuteWarning(source);
  assert.equal(next.includes('Execution mode is not set'), false);
  assert.equal(silenceTurnstileExecuteWarning(next), next);
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

/**
 * Achieves: patchPrivySvgProps rewrites installed dist so GitHub icon SSR has no React invalid-DOM errors and hyphenated attrs are gone from source.
 * Fails when: fill-rule remains in dist, SSR warns, or Turnstile warning remains.
 * Oracle: Rendered SVG DOM after patch + postinstall expectations.
 * Side effects: Patches node_modules under repo root; imports patched chunk.
 * Gaps: Requires @privy-io/react-auth installed.
 */
test('installed Privy GitHub login icon renders without invalid DOM props', async () => {
  const result = patchPrivySvgProps(repoRoot);
  assert.ok(result.scanned > 0, 'expected @privy-io/react-auth to be installed');

  const dist = path.join(repoRoot, 'node_modules', '@privy-io', 'react-auth', 'dist');
  const bundled = walk(dist).map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.equal(bundled.includes('"fill-rule"'), false);
  assert.equal(bundled.includes('"clip-rule"'), false);

  const iconFile = walk(path.join(dist, 'esm')).find((file) => {
    const source = readFileSync(file, 'utf8');
    return source.includes('M16.5083') && source.includes('as G');
  });
  assert.ok(iconFile, 'expected the Privy social icon chunk that exports the GitHub mark');

  const mod = await import(`${pathToFileURL(iconFile).href}?svg-props=${result.patched}`);
  const errors = [];
  const original = console.error;
  console.error = (...args) => {
    errors.push(args.map((part) => String(part)).join(' '));
  };
  let html = '';
  try {
    html = renderToStaticMarkup(createElement(mod.G));
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.match(html, /fill-rule="evenodd"/);
  assert.match(html, /clip-rule="evenodd"/);

  const privySource = walk(dist).map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.equal(privySource.includes('p(t),console.warn("Error generating app config: ",t)'), false);
  const turnstile = path.join(repoRoot, 'node_modules', '@marsidev', 'react-turnstile', 'dist', 'index.js');
  assert.equal(readFileSync(turnstile, 'utf8').includes('Execution mode is not set to "execute"'), false);
});
