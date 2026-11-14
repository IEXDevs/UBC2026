/**
 * Devnet x402 price and trust Worker.
 * Unpaid reads get a v2 PAYMENT-REQUIRED challenge for Circle devnet USDC.
 * A bound confirmDevnetPayment must accept the bot's devnet transfer before
 * the quote or score is returned. This module never opens a network connection.
 */
import {
  DEVNET_USDC_MINT,
  NETWORKS,
  buildPaymentRequired,
  buildPaymentResponse,
  parsePaymentSignature,
} from '@ubc2026/x402';
import { evaluateTrust } from '@ubc2026/trust-score';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const LOW_TRUST_MINT = 'SysvarRent111111111111111111111111111111111';
const PRICE_LABEL = 'devnet execution, mainnet pricing';
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const USD = /^(0|[1-9]\d*)(\.\d+)?$/;
const POSITIVE = /^[1-9][0-9]{0,39}$/;

export const CATALOG = Object.freeze({
  prices: Object.freeze({
    [SOL_MINT]: Object.freeze({ priceUsd: '150.25', quoteSource: 'catalog' }),
    [DEVNET_USDC_MINT]: Object.freeze({ priceUsd: '1.00', quoteSource: 'catalog' }),
  }),
  trust: Object.freeze({
    [SOL_MINT]: Object.freeze({ score: '900', source: 'catalog' }),
    [DEVNET_USDC_MINT]: Object.freeze({ score: '980', source: 'catalog' }),
    [LOW_TRUST_MINT]: Object.freeze({ score: '120', source: 'catalog' }),
  }),
});

function configured(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

function settlement(success, fields) {
  const result = buildPaymentResponse(success ? { success: true, transaction: fields.transaction } : {
    success: false,
    errorMessage: fields.errorMessage,
  });
  return json(success ? fields.body : { error: fields.errorMessage }, success ? 200 : 402, result.headers);
}

function reasonCode(value, fallback) {
  return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/.test(value) ? value : fallback;
}

export function createPriceTrustHandler(options = {}) {
  return async function handle(request, env = {}) {
    const cluster = configured(options.cluster) ?? configured(env.CLUSTER) ?? 'devnet';
    if (cluster !== 'devnet') return json({ error: 'wrong_cluster' }, 403);

    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      const payTo = configured(options.payTo) ?? configured(env.X402_PAY_TO);
      const feePayer = configured(options.feePayer) ?? configured(env.X402_FEE_PAYER);
      return json({
        ok: true,
        product: 'x402-price-trust',
        cluster: 'devnet',
        configured: Boolean(payTo && feePayer),
      });
    }

    const priceMatch = url.pathname.match(/^\/price\/([^/]+)$/);
    const trustMatch = url.pathname.match(/^\/trust\/([^/]+)$/);
    if (!priceMatch && !trustMatch) return json({ error: 'not_found' }, 404);
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

    const kind = priceMatch ? 'price' : 'trust';
    let mint;
    try { mint = decodeURIComponent((priceMatch ?? trustMatch)[1]); } catch { return json({ error: 'invalid_mint' }, 400); }
    if (!MINT.test(mint)) return json({ error: 'invalid_mint' }, 400);

    const lookup = kind === 'price' ? options.lookupPrice : options.lookupTrust;
    let row;
    try {
      row = typeof lookup === 'function' ? await lookup(mint) : CATALOG[kind === 'price' ? 'prices' : 'trust'][mint];
    } catch {
      return json({ error: 'quote_unavailable' }, 502);
    }
    if (!row || typeof row !== 'object') return json({ error: 'not_found', kind, mint }, 404);
    if (kind === 'price' && (typeof row.priceUsd !== 'string' || !USD.test(row.priceUsd))) {
      return json({ error: 'quote_unavailable' }, 502);
    }
    if (kind === 'trust') {
      try { evaluateTrust({ score: row.score, threshold: options.threshold ?? '400', confirmed: false }); }
      catch { return json({ error: 'quote_unavailable' }, 502); }
    }

    const payTo = configured(options.payTo) ?? configured(env.X402_PAY_TO);
    const feePayer = configured(options.feePayer) ?? configured(env.X402_FEE_PAYER);
    const amount = configured(kind === 'price'
      ? (options.priceAmount ?? env.X402_PRICE_AMOUNT)
      : (options.trustAmount ?? env.X402_TRUST_AMOUNT)) ?? (kind === 'price' ? '10000' : '5000');
    if (!payTo || !feePayer || !POSITIVE.test(amount)) return json({ error: 'x402_not_configured' }, 503);

    const resourceUrl = `${url.origin}${url.pathname}`;
    let challenge;
    try {
      challenge = buildPaymentRequired({
        resourceUrl,
        description: kind === 'price' ? `Paid price quote for ${mint}` : `Paid trust score for ${mint}`,
        amount,
        payTo,
        feePayer,
        serviceName: 'UBC2026 price and trust',
      });
    } catch {
      return json({ error: 'x402_not_configured' }, 503);
    }

    const presented = request.headers.get('payment-signature');
    if (!presented) {
      return new Response(JSON.stringify(challenge.body), {
        status: 402,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'payment-required': challenge.headers['PAYMENT-REQUIRED'],
        },
      });
    }

    let parsed;
    try { parsed = parsePaymentSignature(presented); } catch {
      return settlement(false, { errorMessage: 'invalid_payment' });
    }
    const accepted = parsed.accepted;
    if (accepted.amount !== amount || accepted.asset !== DEVNET_USDC_MINT || accepted.payTo !== payTo) {
      return settlement(false, { errorMessage: 'payment_terms_mismatch' });
    }

    const confirm = options.confirmPayment ?? env.confirmDevnetPayment;
    let confirmed = { ok: false, reason: 'settlement_unconfirmed' };
    if (typeof confirm === 'function') {
      try {
        confirmed = await confirm({
          signature: parsed.payload.signature,
          accepted,
          resourceUrl,
          kind,
          mint,
        }) ?? confirmed;
      } catch {
        confirmed = { ok: false, reason: 'settlement_unconfirmed' };
      }
    }
    if (!confirmed || confirmed.ok !== true) {
      return settlement(false, { errorMessage: reasonCode(confirmed?.reason, 'settlement_unconfirmed') });
    }

    const paid = {
      amount,
      asset: DEVNET_USDC_MINT,
      network: NETWORKS.devnet,
      transaction: parsed.payload.signature,
    };
    if (kind === 'price') {
      return settlement(true, {
        transaction: parsed.payload.signature,
        body: {
          mint,
          priceUsd: row.priceUsd,
          quoteSource: typeof row.quoteSource === 'string' ? row.quoteSource : 'catalog',
          pricingCluster: 'mainnet',
          executionCluster: 'devnet',
          label: PRICE_LABEL,
          paid,
        },
      });
    }

    let decision;
    try { decision = evaluateTrust({ score: row.score, threshold: options.threshold ?? '400', confirmed: false }); }
    catch { return json({ error: 'quote_unavailable' }, 502); }
    return settlement(true, {
      transaction: parsed.payload.signature,
      body: {
        mint,
        score: decision.score,
        source: typeof row.source === 'string' ? row.source : 'catalog',
        decision,
        executionCluster: 'devnet',
        paid,
      },
    });
  };
}

const handle = createPriceTrustHandler();

export default {
  fetch(request, env) {
    return handle(request, env ?? {});
  },
};
