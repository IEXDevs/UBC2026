/**
 * Drift guards for Next.js page / layout / error surfaces under apps/web/app.
 * React JSX cannot execute under plain node --test; these assert source contracts
 * that keep branding, crash UX, and wallet provision policy intact.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = (...parts) => join(root, 'app', ...parts);

/**
 * Rigor audit — app/page.js shell contracts (SOURCE READ — does not render React)
 * Achieves: HomePage still gates SignInPage / AuthedShell, provisions only via
 *   walletProvisionPaths()[0], and keeps DeskLock on the authenticated desk.
 * Fails when: runtime wallet create returns, SignInPage removed, or DeskLock dropped.
 * Oracle: shell policy — Next /api/wallets only; Privy gate before desk.
 * Side effects: none.
 * Gaps: source only — does not mount React or fire fetch. Paired with
 *   walletProvisionPaths unit tests + next-api-routes wallets handlers.
 */
test('app/page.js keeps sign-in gate, AuthedShell, and Next-only wallet provision', () => {
  const page = readFileSync(app('page.js'), 'utf8');
  assert.match(page, /export default function HomePage/);
  assert.match(page, /function AuthedShell/);
  assert.match(page, /<SignInPage/);
  assert.match(page, /<DeskLock/);
  assert.match(page, /walletProvisionPaths\(\)\[0\]/);
  assert.match(page, /walletProvisionSucceeded/);
  assert.equal(/\/api\/runtime\/api\/wallets/.test(page), false);
  assert.equal(/fetch\(\s*['"`]\/api\/runtime/.test(page), false);
  assert.match(page, /getPrivyAccessToken|readAccessToken/);
  assert.match(page, /usePrivyPublic/);
});

/**
 * Rigor audit — app/layout.js root wiring (SOURCE READ)
 * Achieves: RootLayout stays force-dynamic, sets Maelstrom metadata, wraps
 *   DeployReload → HostedPreview → CrashGuard → PrivyRoot with publicPrivyIds.
 * Fails when: CrashGuard leaves the tree, Privy ids come from client env, or
 *   hosted preview flag is ignored.
 * Oracle: server layout is the only place that reads public Privy ids + hosted preview.
 * Side effects: none.
 * Gaps: source only — next/font and async layout are not executed in node:test.
 */
test('app/layout.js wires CrashGuard, PrivyRoot, and hosted preview', () => {
  const layout = readFileSync(app('layout.js'), 'utf8');
  assert.match(layout, /export const dynamic = 'force-dynamic'/);
  assert.match(layout, /title: 'Maelstrom'/);
  assert.match(layout, /readHostedDevPreview/);
  assert.match(layout, /publicPrivyIds\(\)/);
  assert.match(layout, /<DeployReload/);
  assert.match(layout, /<HostedPreview enabled=\{hostedPreview\}>/);
  assert.match(layout, /<CrashGuard>/);
  assert.match(layout, /<PrivyRoot appId=\{privy\.appId\} clientId=\{privy\.clientId\}>/);
  assert.match(layout, /html lang="en"/);
  assert.equal(/process\.env\.NEXT_PUBLIC_PRIVY_APP_ID/.test(layout), false);
});

/**
 * Rigor audit — app/not-found.js (SOURCE READ)
 * Achieves: missing routes render shared NotFoundScreen only.
 * Fails when: custom 404 markup replaces NotFoundScreen.
 * Oracle: single 404 UX across missing routes and crashes.
 * Side effects: none.
 * Gaps: JSX not executed — paired with not-found.test.mjs screen contracts.
 */
test('app/not-found.js renders NotFoundScreen', () => {
  const src = readFileSync(app('not-found.js'), 'utf8');
  assert.match(src, /'use client'/);
  assert.match(src, /NotFoundScreen/);
  assert.match(src, /export default function NotFound/);
  assert.equal(/href=/.test(src), false);
});

/**
 * Rigor audit — app/error.js route crash boundary (SOURCE READ)
 * Achieves: route errors log once and render NotFoundScreen (layout stays mounted).
 * Fails when: error UI diverges from 404 screen or console.error is removed.
 * Oracle: Next.js error.js contract + shared NotFoundScreen.
 * Side effects: none.
 * Gaps: does not invoke the Error component (JSX).
 */
test('app/error.js logs and renders NotFoundScreen', () => {
  const src = readFileSync(app('error.js'), 'utf8');
  assert.match(src, /'use client'/);
  assert.match(src, /export default function Error/);
  assert.match(src, /console\.error\(error\)/);
  assert.match(src, /<NotFoundScreen/);
  assert.equal(/<html/.test(src), false);
});

/**
 * Rigor audit — app/global-error.js root crash boundary (SOURCE READ)
 * Achieves: root-layout crashes own html/body + globals.css and still show NotFoundScreen.
 * Fails when: global-error drops html shell or shared 404 screen.
 * Oracle: Next.js global-error must replace the root layout document.
 * Side effects: none.
 * Gaps: does not invoke GlobalError (JSX).
 */
test('app/global-error.js owns html/body and renders NotFoundScreen', () => {
  const src = readFileSync(app('global-error.js'), 'utf8');
  assert.match(src, /'use client'/);
  assert.match(src, /export default function GlobalError/);
  assert.match(src, /console\.error\(error\)/);
  assert.match(src, /globals\.css/);
  assert.match(src, /<html lang="en">/);
  assert.match(src, /<NotFoundScreen/);
});
