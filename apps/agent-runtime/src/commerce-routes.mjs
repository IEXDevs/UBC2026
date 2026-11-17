/**
 * Isaac / 6B + 6C Worker routes:
 * - Shopping sandbox prep/settle + Laso tiny-card challenge
 * - Bot signal x402 sell + settle
 * - SNS resolve/send (unsigned or execute via injected transfer)
 */
import {
  prepareSandboxPurchase,
  settleSandboxPurchase,
  prepareLasoTinyCardPurchase,
  ShoppingError,
} from '@ubc2026/shopping';
import { buildSignalOffer, settleSignalSale, CommerceError } from '@ubc2026/agent-commerce';
import { createSnsResolver, prepareSnsSend, resolveSnsOwner, SnsError } from '@ubc2026/sns';
import { grabBackToMain, TransferError } from '@ubc2026/transfers';
import { DEVNET_USDC_MINT } from '@ubc2026/x402';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function ownerId(request) {
  const value = request.headers.get('x-owner-id');
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(value)) return null;
  return value;
}

function err(error) {
  if (
    error instanceof ShoppingError
    || error instanceof CommerceError
    || error instanceof SnsError
    || error instanceof TransferError
  ) {
    return json({ error: error.code || error.message }, 400);
  }
  // Fail closed — never let catalog/network/X402 surprises become an unhandled 500.
  const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/i.test(error.code)
    ? error.code
    : 'internal';
  return json({ error: code }, 502);
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function defaultResolver(env) {
  if (typeof env.resolveSns === 'function') return createSnsResolver({ resolveFn: env.resolveSns });
  // Demo map for local/dev — production injects a real SNS resolveFn.
  const demo = env.SNS_DEMO_MAP && typeof env.SNS_DEMO_MAP === 'object' ? env.SNS_DEMO_MAP : {};
  return createSnsResolver({
    resolveFn: async (domain) => {
      if (demo[domain]) return demo[domain];
      const resolved = await resolveSnsOwner(domain, { fetcher: env.fetch || fetch });
      return resolved.address;
    },
  });
}

function shoppingBotFrom(body, botId, owner) {
  if (body.bot?.id) return body.bot;
  return {
    id: botId,
    ownerId: owner || body.ownerId || 'owner',
    name: body.name || botId,
    goal: body.goal || 'Compare x402 sandbox catalog and wait for approval before buy',
    type: 'shopping',
    enabled: true,
    frozen: false,
    policyVersion: 1,
    approvalMode: 'ask',
    walletId: body.walletId || 'wallet_demo',
    cap: body.cap || { mode: 'limited', asset: 'USDC', maxOutflow: '20000000', maxPerTransaction: '10000000' },
  };
}

/** POST /bots/:botId/shopping/prepare */
export async function handleShoppingPrepare(request, env, botId) {
  const owner = ownerId(request);
  if (!owner) return json({ error: 'owner_required' }, 401);
  const body = await readBody(request);
  const bot = shoppingBotFrom(body, botId, owner);
  const ledger = body.ledger || { asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
  try {
    if (body.provider === 'laso') {
      const result = await prepareLasoTinyCardPurchase({
        bot,
        ledger,
        amountUsd: body.amountUsd,
        fetcher: env.fetch || fetch,
        baseUrl: env.LASO_BASE_URL,
      });
      return json({ ok: true, botId, ...result });
    }
    const result = await prepareSandboxPurchase({
      bot,
      ledger,
      recipient: body.recipient || env.SANDBOX_PAY_TO || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      storeClient: env.sandboxStoreClient || null,
      fetcher: env.fetch || fetch,
      baseUrl: env.X402_SANDBOX_BASE_URL,
      preferCheapest: body.preferCheapest !== false,
      compareQuality: body.compareQuality !== false,
    });
    return json({ ok: true, botId, provider: 'sandbox', ...result });
  } catch (error) {
    return err(error);
  }
}

/** POST /bots/:botId/shopping/settle — sandbox only (devnet). */
export async function handleShoppingSettle(request, env, botId) {
  const owner = ownerId(request);
  if (!owner) return json({ error: 'owner_required' }, 401);
  const body = await readBody(request);
  try {
    const bot = body.bot || { id: botId };
    const wallet = body.wallet || null;
    const baseSigner = typeof env.signShoppingPayment === 'function'
      ? env.signShoppingPayment
      : body.dryRun
        ? async () => body.signature || 'dry_run_sig'
        : null;
    if (!baseSigner) return json({ error: 'signer_not_configured' }, 503);
    const signPayment = async (args) => baseSigner({
      ...args,
      bot,
      wallet,
      recentBlockhash: body.recentBlockhash,
    });
    const result = await settleSandboxPurchase({
      bot,
      itemId: body.itemId,
      accepted: body.accepted,
      signPayment,
      storeClient: env.sandboxStoreClient || null,
      fetcher: env.fetch || fetch,
      baseUrl: env.X402_SANDBOX_BASE_URL,
      paymentId: body.paymentId,
    });
    if (result?.payment && env.ledgerApi == null && typeof env.persistPayment === 'function') {
      await env.persistPayment(result.payment);
    } else if (result?.payment && env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const { supabaseWrite } = await import('./supabase-rest.mjs');
        await supabaseWrite(env, {
          path: 'payments',
          body: {
            id: result.payment.id,
            bot_id: botId,
            direction: 'paid',
            protocol: 'x402',
            amount: result.payment.amount,
            asset: result.payment.asset === 'USDC' || result.payment.asset?.length < 12
              ? 'USDC'
              : 'USDC',
            counterparty: result.payment.recipient || null,
            cluster: 'devnet',
            tx_signature: result.payment.transaction || null,
          },
          prefer: 'resolution=merge-duplicates,return=minimal',
          fetcher: env.fetch || fetch,
        });
      } catch {
        // Persistence is best-effort; settlement already happened.
      }
    }
    return json({ ok: true, botId, ownerId: owner, ...result });
  } catch (error) {
    return err(error);
  }
}

/** GET/POST /bots/:botId/commerce/signals/:signalId — issue 402 sell challenge. */
export async function handleSignalOffer(request, env, botId, signalId) {
  const body = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await readBody(request);
  try {
    const walletAddress = body.walletAddress || body.payTo || env.SIGNAL_PAY_TO;
    const feePayer = body.feePayer || env.SIGNAL_FEE_PAYER || walletAddress;
    if (!walletAddress || !feePayer) return json({ error: 'wallet_required' }, 400);
    const amount = body.amount || '1000000';
    const origin = new URL(request.url).origin;
    const offer = buildSignalOffer({
      botId,
      signalId,
      walletAddress,
      feePayer,
      amount,
      description: body.description,
      resourceUrl: body.resourceUrl || `${origin}/bots/${encodeURIComponent(botId)}/commerce/signals/${encodeURIComponent(signalId)}`,
    });
    // Persist offer in memory/KV when available for settle.
    if (env.signalOffers?.put) {
      await env.signalOffers.put(`${botId}:${signalId}`, JSON.stringify(offer));
    }
    return new Response(JSON.stringify(offer.challenge.body), {
      status: 402,
      headers: {
        ...offer.challenge.headers,
        'content-type': 'application/json',
        'Cache-Control': 'no-store',
        'x-maelstrom-bot-id': botId,
        'x-maelstrom-signal-id': signalId,
      },
    });
  } catch (error) {
    return err(error);
  }
}

/** POST /bots/:botId/commerce/signals/:signalId/settle */
export async function handleSignalSettle(request, env, botId, signalId) {
  const body = await readBody(request);
  const header = request.headers.get('payment-signature')
    || request.headers.get('PAYMENT-SIGNATURE')
    || body.paymentSignature;
  if (!header) return json({ error: 'payment_signature_required' }, 402);
  try {
    let offer = body.offer || null;
    if (!offer && env.signalOffers?.get) {
      const raw = await env.signalOffers.get(`${botId}:${signalId}`);
      if (raw) offer = JSON.parse(raw);
    }
    if (!offer) {
      // Rebuild from request fields when store is cold.
      offer = buildSignalOffer({
        botId,
        signalId,
        walletAddress: body.walletAddress,
        feePayer: body.feePayer || body.walletAddress,
        amount: body.amount || '1000000',
        resourceUrl: body.resourceUrl || `https://runtime/bots/${botId}/commerce/signals/${signalId}`,
        description: body.description,
      });
    }
    const payload = body.signalPayload || env.loadSignal?.(botId, signalId) || {
      signalId,
      summary: body.summary || 'Signal released after x402 payment',
      at: Date.now(),
    };
    const result = settleSignalSale({
      offer,
      paymentSignatureHeader: header,
      signalPayload: payload,
      buyer: body.buyer || '11111111111111111111111111111111',
      paymentId: body.paymentId,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return err(error);
  }
}

/** POST /bots/:botId/sns/send */
export async function handleSnsSend(request, env, botId) {
  if (!ownerId(request)) return json({ error: 'owner_required' }, 401);
  const body = await readBody(request);
  try {
    const resolver = defaultResolver(env);
    const bot = body.bot || null;
    const wallet = body.wallet || null;
    const executeTransfer = body.execute === true && typeof env.executeSnsTransfer === 'function'
      ? async (args) => env.executeSnsTransfer({
        ...args,
        bot,
        wallet,
        recentBlockhash: body.recentBlockhash,
      })
      : null;
    const result = await prepareSnsSend({
      from: body.from || wallet?.address,
      domain: body.domain,
      amount: body.amount,
      asset: body.asset || 'USDC',
      botId,
      resolver,
      executeTransfer,
      memo: body.memo,
    });
    return json({ ok: true, botId, mintHint: DEVNET_USDC_MINT, ...result });
  } catch (error) {
    return err(error);
  }
}

/** POST /security/grab-back — owner sweep additional wallets to main (Alex transfers helper). */
export async function handleGrabBack(request, env) {
  const owner = ownerId(request);
  if (!owner) return json({ error: 'owner_required' }, 401);
  const body = await readBody(request);
  if (!body.mainWallet || !Array.isArray(body.wallets)) {
    return json({ error: 'wallets_required' }, 400);
  }
  if (!env.transferClient && !body.dryRun) {
    return json({ error: 'signer_not_configured' }, 503);
  }
  try {
    if (body.dryRun) {
      return json({
        ok: true,
        dryRun: true,
        kind: 'grab-back',
        cluster: 'devnet',
        memo: 'funds.grabbed',
        moves: body.wallets
          .filter((w) => w.kind === 'additional')
          .map((w) => ({ from: w.address, to: body.mainWallet.address, status: 'planned' })),
      });
    }
    const result = await grabBackToMain({
      client: env.transferClient,
      ownerId: owner,
      mainWallet: body.mainWallet,
      wallets: body.wallets,
      balances: body.balances || null,
      recentBlockhash: body.recentBlockhash,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return err(error);
  }
}

/** Route dispatcher for commerce/shopping/sns/security paths. */
export function matchCommerceRoute(method, pathname) {
  if (pathname === '/security/grab-back' && method === 'POST') return { kind: 'grab-back' };
  const shopPrep = pathname.match(/^\/bots\/([^/]+)\/shopping\/prepare$/);
  if (shopPrep && method === 'POST') return { kind: 'shopping-prepare', botId: decodeURIComponent(shopPrep[1]) };
  const shopSettle = pathname.match(/^\/bots\/([^/]+)\/shopping\/settle$/);
  if (shopSettle && method === 'POST') return { kind: 'shopping-settle', botId: decodeURIComponent(shopSettle[1]) };
  const signalSettle = pathname.match(/^\/bots\/([^/]+)\/commerce\/signals\/([^/]+)\/settle$/);
  if (signalSettle && method === 'POST') {
    return { kind: 'signal-settle', botId: decodeURIComponent(signalSettle[1]), signalId: decodeURIComponent(signalSettle[2]) };
  }
  const signal = pathname.match(/^\/bots\/([^/]+)\/commerce\/signals\/([^/]+)$/);
  if (signal && (method === 'GET' || method === 'POST')) {
    return { kind: 'signal-offer', botId: decodeURIComponent(signal[1]), signalId: decodeURIComponent(signal[2]) };
  }
  const sns = pathname.match(/^\/bots\/([^/]+)\/sns\/send$/);
  if (sns && method === 'POST') return { kind: 'sns-send', botId: decodeURIComponent(sns[1]) };
  return null;
}

export async function dispatchCommerceRoute(request, env, matched) {
  switch (matched.kind) {
    case 'shopping-prepare': return handleShoppingPrepare(request, env, matched.botId);
    case 'shopping-settle': return handleShoppingSettle(request, env, matched.botId);
    case 'signal-offer': return handleSignalOffer(request, env, matched.botId, matched.signalId);
    case 'signal-settle': return handleSignalSettle(request, env, matched.botId, matched.signalId);
    case 'sns-send': return handleSnsSend(request, env, matched.botId);
    case 'grab-back': return handleGrabBack(request, env);
    default: return json({ error: 'not_found' }, 404);
  }
}
