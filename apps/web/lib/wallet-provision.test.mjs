import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeObservedWallets,
  missingWalletSecrets,
  resolvePrivyAppId,
  walletConfigNote,
  walletProvisionNote,
  walletProvisionPaths,
  walletProvisionSucceeded,
  linkedWalletKey,
  walletsFromPrivyUser,
} from './wallet-provision.mjs';

/**
 * Rigor audit — shell provision URL contract
 * Achieves: provision path list is exactly Next `/api/wallets` (frozen).
 * Fails when: runtime create or persist is added to the shell attempt list
 *   (Workers strip Origin → 502 overwrite of Next errors).
 * Oracle: Cloudflare Workers cannot set outbound Origin for Privy `/users/me`.
 * Side effects: Object.freeze prevents mutation of the returned list.
 * Gaps: none for the helper. page.js usage is enforced in next-api-routes.test.mjs.
 */
test('shell wallet provision never hits the runtime create path', () => {
  const paths = walletProvisionPaths();
  assert.deepEqual([...paths], ['/api/wallets']);
  assert.equal(paths.some(path => path.includes('/api/runtime/')), false);
  assert.equal(paths.some(path => path.includes('persist')), false);
  assert.throws(() => { paths.push('/api/runtime/api/wallets'); });
});

/**
 * Rigor audit — provision success predicate
 * Achieves: success requires boolean true ok AND non-empty wallets array.
 * Fails when: HTTP 200 coerced as truthy, empty wallets treated as success, or
 *   status code numbers accepted as ok.
 * Oracle: shell must show at least one wallet row after provision.
 * Side effects: none (pure).
 * Gaps: none — closed: null/undefined body, wallets: null, ok: 'true' string.
 */
test('walletProvisionSucceeded requires ok response and a non-empty wallets array', () => {
  assert.equal(walletProvisionSucceeded(true, { wallets: [{ id: 'w1' }] }), true);
  assert.equal(walletProvisionSucceeded(true, { wallets: [] }), false);
  assert.equal(walletProvisionSucceeded(true, {}), false);
  assert.equal(walletProvisionSucceeded(false, { wallets: [{ id: 'w1' }] }), false);
  assert.equal(walletProvisionSucceeded(200, { wallets: [{ id: 'w1' }] }), false);
  assert.equal(walletProvisionSucceeded(true, null), false);
  assert.equal(walletProvisionSucceeded(true, { wallets: null }), false);
  assert.equal(walletProvisionSucceeded('true', { wallets: [{ id: 'w1' }] }), false);
});

/**
 * Rigor audit — required Privy env names
 * Achieves: NEXT_PUBLIC_PRIVY_APP_ID can stand in for PRIVY_APP_ID; secret still required.
 * Fails when: public id is ignored (false missing) or secret absence is hidden.
 * Oracle: acceptLogin needs app id + app secret; public id equals server id in this app.
 * Side effects: none.
 * Gaps: none for presence checks (values are not validated against Privy).
 */
test('missing wallet secrets allow public app id as PRIVY_APP_ID', () => {
  assert.deepEqual(
    missingWalletSecrets({
      NEXT_PUBLIC_PRIVY_APP_ID: 'app_1',
      PRIVY_APP_SECRET: 'secret',
    }),
    [],
  );
  assert.deepEqual(
    missingWalletSecrets({ NEXT_PUBLIC_PRIVY_APP_ID: 'app_1' }),
    ['PRIVY_APP_SECRET'],
  );
  assert.equal(resolvePrivyAppId({ NEXT_PUBLIC_PRIVY_APP_ID: ' app_1 ' }), 'app_1');
  assert.equal(resolvePrivyAppId({ PRIVY_APP_ID: 'server', NEXT_PUBLIC_PRIVY_APP_ID: 'pub' }), 'server');
});

/**
 * Rigor audit — linked wallet fingerprint for re-provision
 * Achieves: key changes when another Solana address appears on the Privy user.
 * Fails when: snake_case linked_accounts ignored or multi-wallet key equals single.
 * Oracle: sorted unique Solana addresses drive the fingerprint.
 * Side effects: none.
 * Gaps: none for change detection. Remaining: does not prove page.js effect deps.
 */
test('linkedWalletKey changes when another Solana wallet is added', () => {
  const first = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const second = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  assert.equal(linkedWalletKey(null), '');
  assert.equal(linkedWalletKey({ linkedAccounts: [{ address: first }] }), first);
  assert.notEqual(
    linkedWalletKey({ linkedAccounts: [{ address: first }] }),
    linkedWalletKey({ linked_accounts: [{ address: first }, { address: second }] }),
  );
});

/**
 * Rigor audit — Privy user → shell wallet rows (embedded)
 * Achieves: createOnLogin-style Solana embedded account maps to main spendable wallet.
 * Fails when: null id drops the wallet or ownerId is wrong.
 * Oracle: Privy linkedAccounts wallet + solana + privy client = agent main.
 * Side effects: none.
 * Gaps: none for single embedded case.
 */
test('walletsFromPrivyUser maps createOnLogin Solana embedded addresses', () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const wallets = walletsFromPrivyUser({
    linkedAccounts: [
      {
        type: 'wallet',
        id: null,
        address,
        chainType: 'solana',
        walletClientType: 'privy',
        connectorType: 'embedded',
      },
    ],
  }, 'did:privy:user1');
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].kind, 'main');
  assert.equal(wallets[0].address, address);
  assert.equal(wallets[0].ownerId, 'did:privy:user1');
});

/**
 * Rigor audit — external Solana wallets are observe-only
 * Achieves: Phantom kept as non-spendable; Ethereum wallets dropped.
 * Fails when: external wallets marked spendable or EVM addresses leak into the list.
 * Oracle: only Solana chainType; spendable only for Privy embedded agent wallet.
 * Side effects: none.
 * Gaps: none for mix of embedded/external/EVM.
 */
test('walletsFromPrivyUser also keeps connected external Solana wallets', () => {
  const embedded = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const phantom = 'So11111111111111111111111111111111111111112';
  const wallets = walletsFromPrivyUser({
    linkedAccounts: [
      {
        type: 'wallet',
        address: embedded,
        chainType: 'solana',
        walletClientType: 'privy',
      },
      {
        type: 'wallet',
        address: phantom,
        chainType: 'solana',
        walletClientType: 'phantom',
      },
      {
        type: 'wallet',
        address: '0xabc123',
        chainType: 'ethereum',
        walletClientType: 'metamask',
      },
    ],
  }, 'did:privy:user1');
  assert.equal(wallets.length, 2);
  assert.equal(wallets[0].address, embedded);
  assert.equal(wallets[0].spendable, true);
  assert.equal(wallets[1].address, phantom);
  assert.equal(wallets[1].walletClientType, 'phantom');
  assert.equal(wallets[1].label, 'Phantom');
  assert.equal(wallets[1].spendable, false);
});

/**
 * Rigor audit — merge server rows with Privy linked accounts
 * Achieves: keeps agent main id; appends linked Phantom as additional non-spendable.
 * Fails when: main replaced by linked duplicate or Phantom marked spendable.
 * Oracle: address equality for dedupe; linked_ prefix / spendable false for externals.
 * Side effects: none.
 * Gaps: none for this merge shape.
 */
test('mergeObservedWallets keeps the agent wallet and appends linked wallets', () => {
  const agent = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const phantom = 'So11111111111111111111111111111111111111112';
  const merged = mergeObservedWallets(
    [{ id: 'w_main', kind: 'main', label: 'Main', address: agent, frozen: false, provider: 'privy' }],
    {
      linkedAccounts: [
        { type: 'wallet', address: agent, chainType: 'solana', walletClientType: 'privy' },
        { type: 'wallet', address: phantom, chainType: 'solana', walletClientType: 'phantom' },
      ],
    },
    'did:privy:user1',
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'w_main');
  assert.equal(merged[0].kind, 'main');
  assert.equal(merged[0].spendable, true);
  assert.equal(merged[1].address, phantom);
  assert.equal(merged[1].kind, 'additional');
  assert.equal(merged[1].spendable, false);
});

/**
 * Rigor audit — Worker Origin failure copy + secret redaction
 * Achieves: Worker Origin detail maps to Domains guidance; sk_live never echoed.
 * Fails when: detail with Bearer sk_* is shown to the user, or Origin failures
 *   get a generic unhelpful note.
 * Oracle: UX must never display API keys; Origin failures point at Privy Domains.
 * Side effects: none.
 * Gaps: none — closed: explicit assertion that note matches /Domains/i for Worker text.
 */
test('wallet provision notes explain Worker Origin failures without leaking secrets', () => {
  const originNote = walletProvisionNote({
    error: 'privy_failed',
    detail: 'Worker cannot set Origin for Privy; use POST /api/wallets on Next then /api/wallets/persist',
  });
  assert.match(originNote, /Origin|Domains/i);
  assert.equal(originNote.includes('sk_'), false);
  assert.equal(
    walletProvisionNote({
      error: 'privy_failed',
      detail: 'Bearer sk_live_super_secret_value_that_must_not_leak',
    }).includes('sk_live'),
    false,
  );
  assert.equal(
    walletProvisionNote({
      error: 'privy_failed',
      detail: 'api_key=super_secret_value_abcdef',
    }).includes('super_secret'),
    false,
  );
});

/**
 * Rigor audit — actionable secret-free notes across error codes
 * Achieves: missing env names listed; 403 variants guide full-access / auth key;
 *   injection in missing[] rejected; success copy for created main.
 * Fails when: notes include raw secret values or omit the actionable env name.
 * Oracle: only env *names* and safe codes; never values from detail that look like keys.
 * Side effects: none.
 * Gaps: none for the enumerated codes. Remaining: unknown error codes fall through
 *   to generic copy (acceptable).
 */
test('wallet provision notes stay actionable and secret-free', () => {
  assert.match(
    walletProvisionNote({ error: 'missing_config', missing: ['PRIVY_APP_SECRET', 'QUICKNODE_DEVNET_RPC_URL'] }),
    /PRIVY_APP_SECRET, QUICKNODE_DEVNET_RPC_URL/,
  );
  assert.match(walletProvisionNote({ error: 'invalid_rpc' }), /https QuickNode/);
  assert.match(walletProvisionNote({ error: 'privy_failed' }), /PRIVY_APP_SECRET/);
  assert.match(
    walletProvisionNote({ error: 'privy_failed', detail: 'Privy request failed (401)' }),
    /Privy request failed \(401\)/,
  );
  assert.match(
    walletProvisionNote({
      error: 'privy_failed',
      detail: 'Privy wallets failed (403: insufficient_app_secret_permissions)',
    }),
    /full-access/,
  );
  assert.match(
    walletProvisionNote({
      error: 'privy_failed',
      detail: 'Privy wallets failed (403). Set PRIVY_AUTHORIZATION_KEY from Privy',
    }),
    /PRIVY_AUTHORIZATION_KEY/,
  );
  assert.equal(
    walletProvisionNote({ created: true, wallets: [{ id: 'w1' }] }, { ok: true }),
    'Main wallet created and assigned to these agents.',
  );
  assert.equal(walletProvisionNote({ error: 'missing_config', missing: ['evil; drop'] }).includes('evil'), false);
  assert.match(walletProvisionNote({ error: 'token_missing' }), /access token/);
  assert.match(walletConfigNote({ missing: ['PRIVY_APP_SECRET'] }), /PRIVY_APP_SECRET/);
  assert.match(walletConfigNote({ hasAppSecret: true, hasAuthorizationKey: false }), /PRIVY_AUTHORIZATION_KEY/);
  assert.equal(walletConfigNote({ hasAppId: true, hasAppSecret: true, hasAuthorizationKey: true }), '');
});

test('walletConfigFlags reports alignment without leaking app ids', async () => {
  const { walletConfigFlags } = await import('./wallet-provision.mjs');
  const aligned = walletConfigFlags({
    PRIVY_APP_ID: 'cm_test_app',
    NEXT_PUBLIC_PRIVY_APP_ID: 'cm_test_app',
    PRIVY_APP_SECRET: 'secret',
    PRIVY_AUTHORIZATION_KEY: 'wallet-auth:test',
    QUICKNODE_DEVNET_RPC_URL: 'https://example.quiknode.pro/x',
    NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://runtime.maelstrom.iexdevs.com',
  });
  assert.equal(aligned.appIdAligned, true);
  assert.equal(aligned.runtimeHostOk, true);
  assert.equal(aligned.hasRuntimeUrl, true);
  assert.equal(JSON.stringify(aligned).includes('cm_test_app'), false);

  const mismatched = walletConfigFlags({
    PRIVY_APP_ID: 'cm_server',
    NEXT_PUBLIC_PRIVY_APP_ID: 'cm_public',
    PRIVY_APP_SECRET: 'secret',
  });
  assert.equal(mismatched.appIdAligned, false);
  assert.equal(mismatched.hasPublicAppId, true);
});
