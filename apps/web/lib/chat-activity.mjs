import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';

/**
 * Public chat trace for a tool round. Titles, hosts, and queries only.
 * Live View URLs and raw tool payloads stay out.
 */
import { parsePrivySigningFailure } from '@ubc2026/contracts';

const LABELS = Object.freeze({
  web_search: 'Searched the web',
  web_scrape: 'Read a page',
  browser_open: 'Opened a browser',
  browser_navigate: 'Opened a page',
  browser_live_view: 'Checked the live view',
  browser_release: 'Released the browser',
  get_price: 'Checked a price',
  prepare_shopping: 'Shopping API',
  request_spend: 'Spend API',
  create_loop: 'Started a loop',
  set_loop_cooldown: 'Set the loop cooldown',
  break_loop: 'Broke the loop',
});

const PAGE_TOOLS = new Set(['web_scrape', 'browser_navigate', 'browser_open']);
const SPEND_LIMIT_MESSAGES = new Map([
  ['per-transaction', "This payment exceeds the agent's per-transfer limit."],
  ['total-outflow', "This payment exceeds the agent's remaining spending budget."],
  ['over-budget', "This payment exceeds the agent's spending budget."],
]);
const SPEND_BLOCK_MESSAGES = new Map([
  ...SPEND_LIMIT_MESSAGES,
  ['accounting-asset-mismatch', "The payment asset does not match the agent's spending asset."],
  ['approval-needed', 'The budget reservation needs a valid approval.'],
  ['approval-save-failed', 'The spend service could not save the approval.'],
  ['bot-disabled', 'The agent is disabled.'],
  ['bot-frozen', 'The agent is frozen.'],
  ['bot-missing', 'The agent is no longer available.'],
  ['budget-override-required', "This payment needs a separate approval to exceed the agent's spending budget."],
  ['duplicate-spend', 'This confirmation was already used to attempt a payment. Check the wallet before trying again.'],
  ['invalid-approval', 'The budget reservation rejected this approval.'],
  ['invalid-approval-action', 'The budget reservation rejected this approval.'],
  ['ledger-missing', "The agent's spending ledger is missing."],
  ['max-loss-reached', 'The agent reached its loss limit.'],
  ['quote-expired', 'The payment quote expired.'],
  ['swap_quote_expired', 'The swap quote expired or changed. Ask for a fresh quote.'],
  ['swap_owner_authorization_required', 'Approve this swap in the desk with your Privy wallet.'],
  ['usd_price_unavailable', 'A current USD price was unavailable. The spend did not go through.'],
  ['reserve-failed', "The spend service could not reserve funds from the agent's budget."],
  ['spend_authorization_changed', 'The payment changed after wallet authorization. Ask for the payment again.'],
  ['wallet_authorization_failed', 'The spend service could not prepare wallet authorization. Ask for the payment again.'],
  ['rpc_policy_reserve_budget_failed', "The spend service could not reserve funds from the agent's budget."],
  ['spend-frozen', 'The agent or its wallet is frozen.'],
  ['trust-unavailable', 'The spend service could not verify the trust score.'],
  ['wallet-frozen', 'The wallet is frozen.'],
  ['wallet-missing', "The agent's wallet is missing."],
  ['wallet-owner-mismatch', 'The wallet belongs to a different account.'],
  ['wrong-owner', 'The agent belongs to a different account.'],
]);
const SPEND_SIGN_MESSAGES = new Map([
  ['invalid_authorization_key', 'The Worker could not use its configured Privy authorization key.'],
  ['invalid_wallet', "The agent's wallet is missing a valid Privy signing ID."],
  ['privy_failed', 'Privy rejected the signing request.'],
  ['rpc_failed', 'The mainnet-beta RPC did not return a receipt. Check the wallet before trying again.'],
  ['rpc_rejected', 'The mainnet-beta RPC did not return a receipt. Check the wallet before trying again.'],
  ['simulation_required', 'The signing service could not verify the transaction simulation.'],
  ['transaction_mismatch', 'The signed transaction differed from the simulated payment.'],
  ['wallet_authorization_failed', 'Privy could not authorize signing with this session.'],
  ['wallet_owner_session_required', 'Sign in again as the wallet owner to authorize the payment.'],
  ['wallet_policy_rejected', 'The Privy wallet policy rejected this payment.'],
  ['wrong_cluster', 'The signing service could not verify the Solana mainnet-beta connection.'],
]);
const PRIVY_TRANSPORT_MESSAGES = new Map([
  ['network', 'The Worker could not reach Privy to sign this payment.'],
  ['timeout', 'The Privy signing request timed out.'],
  ['redirect', 'Privy redirected the signing request.'],
  ['invalid-response', 'Privy did not return a readable signed transaction.'],
]);
const PRIVY_WALLET_LOOKUP_MESSAGES = new Map([
  [200, 'The same app credentials could read this wallet. Privy rejected authorization for the signing request.'],
  [401, 'Privy also rejected the signing Worker’s app credentials on a read-only wallet lookup.'],
  [404, 'Privy could not find the sending wallet under this app’s credentials.'],
]);
const PRIVY_REQUEST_LABELS = {
  'app-sign': 'App signing (POST /v1/wallets/{wallet_id}/rpc, signTransaction)',
  'wallet-lookup': 'Wallet lookup (GET /v1/wallets/{wallet_id})',
  'session-exchange': 'Owner session key exchange (POST /v1/wallets/authenticate, HPKE)',
  'owner-sign': 'Owner-session signing (POST /v1/wallets/{wallet_id}/rpc, signTransaction)',
  'browser-owner-sign': 'Browser-authorized signing (POST /v1/wallets/{wallet_id}/rpc, signTransaction)',
};
const PRIVY_REQUEST_DETAILS = {
  'wallet-matched': 'Wallet ID, Solana chain, and sending address matched.',
  'wallet-mismatch': 'The response did not match the expected wallet ID, Solana chain, or sending address.',
  'missing-signed-transaction': 'Privy returned no serialized signed transaction.',
  'mfa-required': 'Privy indicated that it requires multi-factor verification.',
  'mfa-enrollment-required': 'Privy indicated that the owner must enroll in multi-factor verification.',
  'token-expired': 'Privy indicated that the session token expired.',
  'token-invalid': 'Privy indicated that the session token was invalid.',
  'jwt-configuration': 'Privy indicated a JWT authentication or verification-key configuration problem.',
  'no-wallets': 'Privy indicated that it could not find wallets for this session.',
  'invalid-encryption': 'Privy indicated an encryption or recipient public key problem.',
  'invalid-data': 'Privy indicated that request data was invalid.',
  'provider-detail': 'Privy returned a detail outside the supported error codes.',
  'local-failure': 'The Worker could not prepare this request or process the result.',
};
const PRIVY_SESSION_LABELS = {
  missing: 'No bearer token reached the signing Worker.',
  unreadable: 'The bearer token had no readable owner claim.',
  'owner-mismatch': 'The token owner claim differed from the sending wallet owner.',
  'owner-matched': 'The token owner claim matched the sending wallet owner.',
};
const PRIVY_ERROR_LENGTH = 3200;
const SECRET_KEY = /key|token|secret|password|authorization|cookie|seed|phrase/i;
const SECRET_VALUE = /eyJ[A-Za-z0-9_-]{8,}|live\.browser\.run/i;

function clip(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseResult(result) {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return result && typeof result === 'object' ? result : null;
}

function publicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.replace(/^www\./, '').slice(0, 120);
    if (!host || host === 'live.browser.run') return null;
    return { url: url.href.slice(0, 500), host };
  } catch {
    return null;
  }
}

function siteFrom(entry) {
  const page = publicUrl(entry?.url);
  if (!page) return null;
  return { title: clip(entry?.title, 140), url: page.url, host: page.host };
}

function sitesFrom(parsed) {
  const rows = Array.isArray(parsed?.results) ? parsed.results : [];
  const sites = [];
  for (const entry of rows) {
    const site = siteFrom(entry);
    if (!site) continue;
    if (sites.some(item => item.url === site.url)) continue;
    sites.push(site);
    if (sites.length >= 6) break;
  }
  return sites;
}

export function thinkStep(text) {
  const clean = clip(text, 800);
  if (!clean) return null;
  return { kind: 'think', text: clean };
}

function claimLinks(value, key = '', depth = 0, found = []) {
  if (depth > 5 || found.length >= 2) return found;
  if (typeof value === 'string' && /claim/i.test(key)) {
    const page = publicUrl(value);
    if (page) found.push(page.url);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  const entries = Array.isArray(value) ? value.map(item => ['', item]) : Object.entries(value);
  for (const [childKey, child] of entries) {
    if (SECRET_KEY.test(childKey)) continue;
    claimLinks(child, childKey, depth + 1, found);
  }
  return found;
}

/**
 * Owner-visible line for an API tool result. Claim links and quote fields stay.
 * Payment headers, secrets, and Live View URLs stay out.
 */
export function publicApiSummary(name, result) {
  const parsed = parseResult(result);
  if (!parsed || (name !== 'prepare_shopping' && name !== 'request_spend')) return '';
  if (typeof parsed.signature === 'string' && parsed.signature) return '';
  const links = [...new Set(claimLinks(parsed))];
  const title = name === 'prepare_shopping'
    ? (parsed.provider === 'laso' ? 'Laso API' : 'Shopping API')
    : 'Spend API';
  if (links.length > 0) return `${title} returned ${links.join(' ')}`;
  const payTo = parsed.challenge?.accepted?.payTo || parsed.proposal?.recipient || '';
  const outflow = parsed.proposal?.outflow || '';
  const next = parsed.next || parsed.state || '';
  let hint = clip(parsed.hint, 240);
  if ((parsed.error === 'simulation_failed' || parsed.state === 'simulation_failed') && !hint) {
    hint = 'The USDC transfer did not simulate. The wallet needs the USDC and a little SOL for the fee. Nothing was sent.';
  }
  if (typeof parsed.error === 'string' && parsed.error) {
    return `${title}: ${hint || parsed.error}`;
  }
  const bits = [];
  if (parsed.provider) bits.push(String(parsed.provider));
  if (parsed.amountUsd != null) bits.push(`$${parsed.amountUsd}`);
  if (outflow) bits.push(`${outflow} base units`);
  if (payTo) bits.push(`to ${payTo}`);
  if (next) bits.push(`next ${next}`);
  return bits.length > 0 ? `${title}: ${bits.join(', ')}` : '';
}

function commandLine(name, args) {
  const parts = [name];
  if (!args || typeof args !== 'object' || Array.isArray(args)) return name;
  for (const key of Object.keys(args).slice(0, 6)) {
    if (SECRET_KEY.test(key)) continue;
    const value = args[key];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const text = String(value).trim();
    if (!text || SECRET_VALUE.test(text)) continue;
    parts.push(`${key}=${text.slice(0, 120)}`);
  }
  return parts.join(' ').slice(0, 240);
}

export function spendFailureCode(result) {
  const parsed = parseResult(result);
  return parsed?.error || parsed?.state;
}

function privyDiagnosticMessage(privy, reason) {
  const lines = [
    `Signing stopped before broadcast on Solana ${SOLANA_CLUSTER}.`,
    SPEND_SIGN_MESSAGES.has(reason) && `Maelstrom reason ${reason}.`,
    privy.at && `Worker time ${new Date(privy.at).toISOString()}.`,
    typeof privy.appSignature === 'boolean'
      && `App authorization signature header ${privy.appSignature ? 'present' : 'absent'}.`,
  ];
  for (const request of privy.requests) {
    const result = request.status ? `HTTP ${request.status}` : 'no HTTP response';
    lines.push([
      `${PRIVY_REQUEST_LABELS[request.stage]} returned ${result}.`,
      request.code && `Privy code ${request.code}.`,
      request.transport && `Transport result ${request.transport}.`,
      request.detail && (request.detail !== 'provider-detail' || !request.code) && PRIVY_REQUEST_DETAILS[request.detail],
      typeof request.mfaProof === 'boolean' && `MFA proof header ${request.mfaProof ? 'present' : 'absent'}.`,
      request.requestId && `Privy request ID ${request.requestId}.`,
      request.edgeId && `Cloudflare Ray ID ${request.edgeId}.`,
    ].filter(Boolean).join(' '));
  }
  if (privy.session) {
    const { check, audience, issuer, expiry } = privy.session;
    lines.push([
      PRIVY_SESSION_LABELS[check],
      audience && `Token audience ${audience}.`,
      issuer && `Token issuer ${issuer}.`,
      expiry && `Token expiry ${expiry}.`,
      audience && 'The Worker read these claims locally. Privy verifies the token.',
    ].filter(Boolean).join(' '));
    const stages = new Set(privy.requests.map(request => request.stage));
    if (!stages.has('owner-sign')) lines.push('The Worker did not send an owner-session signing request.');
  }
  return lines.filter(Boolean).join('\n');
}

export function spendFailureMessage(result) {
  const parsed = parseResult(result);
  if (parsed?.error === 'swap_intent_unavailable' || parsed?.reason === 'swap_intent_unavailable') {
    return 'This swap is no longer pending. Ask the agent to find another trade.';
  }
  switch (parsed?.error || parsed?.state) {
    case 'invalid_spend_approval':
      return 'The payment approval expired or the payment details changed. Ask for the payment again.';
    case 'approval-needed':
      return SPEND_LIMIT_MESSAGES.get(parsed.reason)
        || (!parsed.reason ? 'The spend request reached the server without an accepted confirmation.' : '');
    case 'simulation_failed':
      return 'The USDC transfer did not simulate. The wallet needs the USDC and a little SOL for the fee. Nothing was sent.';
    case 'blocked':
      return SPEND_BLOCK_MESSAGES.get(parsed.reason) || 'The spend service blocked this payment without a recognized reason.';
    case 'spend_authorization_expired':
      return 'Wallet authorization expired. Ask for the payment again.';
    case 'invalid_spend_authorization':
      return 'The wallet authorization was invalid. Ask for the payment again.';
    case 'wallet_authorization_unavailable':
      return 'The spend service could not prepare an authorization request for this wallet.';
    case 'sign-rejected': {
      const privy = parsePrivySigningFailure(parsed.privyFailure);
      const browserAuthorized = privy?.requests?.some(request => request.stage === 'browser-owner-sign');
      const message = (browserAuthorized && parsed.reason === 'wallet_authorization_failed'
        ? 'Privy rejected the signing request authorized by your browser.'
        : SPEND_SIGN_MESSAGES.get(parsed.reason))
        || 'The signing step returned no receipt. Check the wallet before trying again.';
      if (privy?.requests?.length) return `${message}\n${privyDiagnosticMessage(privy, parsed.reason)}`;
      const transport = PRIVY_TRANSPORT_MESSAGES.get(privy?.transport);
      if (transport) return transport;
      const details = [privy?.status && `HTTP ${privy.status}`, privy?.code].filter(Boolean).join(', ');
      const lookupStatus = privy?.walletLookupStatus;
      const lookup = lookupStatus && [
        `The wallet lookup returned HTTP ${lookupStatus}.`,
        PRIVY_WALLET_LOOKUP_MESSAGES.get(lookupStatus),
      ].filter(Boolean).join(' ');
      return [message, details && `Privy reported ${details}.`, lookup].filter(Boolean).join('\n');
    }
    default:
      return '';
  }
}

function failureText(name, parsed) {
  const spend = name === 'request_spend';
  const error = clip(parsed?.error || (spend ? parsed?.state : ''), 80).replace(SECRET_VALUE, '[hidden]');
  const hint = clip(parsed?.hint, 180).replace(SECRET_VALUE, '[hidden]');
  const extra = clip(typeof parsed?.detail === 'string' ? parsed.detail : '', 180).replace(SECRET_VALUE, '[hidden]');
  const spendReason = spend ? spendFailureMessage(parsed) : '';
  return [...new Set([error, hint, extra, spendReason].filter(Boolean))]
    .join('\n')
    .slice(0, spend ? PRIVY_ERROR_LENGTH : 400);
}

function withFailure(step, name, args, parsed, failed) {
  if (!failed) return step;
  return {
    ...step,
    status: 'error',
    command: commandLine(name, args),
    error: failureText(name, parsed),
  };
}

export function toolStep(name, args, result) {
  const tool = clip(name, 64);
  if (!tool) return null;
  const parsed = parseResult(result);
  const failed = (typeof parsed?.error === 'string' && parsed.error.length > 0) || parsed?.ok === false;
  const status = failed ? 'error' : 'done';
  if (parsed?.error === 'repeated_tool') return null;
  if (parsed?.error === 'site_blocked') {
    return withFailure({
      kind: 'tool',
      name: tool,
      label: 'Skipped a blocked site',
      detail: clip(parsed.host, 80),
      status: 'error',
    }, tool, args, parsed, true);
  }
  if (tool === 'web_search') {
    const query = clip(args?.query, 160);
    return withFailure({
      kind: 'search',
      query: /^(search|web search|browse|browser)$/i.test(query) ? '' : query,
      sites: failed ? [] : sitesFrom(parsed),
      status,
    }, tool, args, parsed, failed);
  }
  if (PAGE_TOOLS.has(tool)) {
    const page = siteFrom({
      url: parsed?.page?.url || parsed?.url || args?.url,
      title: parsed?.page?.title || parsed?.title,
    });
    if (page && !failed) {
      return { kind: 'page', label: LABELS[tool], title: page.title, url: page.url, host: page.host, status };
    }
  }
  const detail = tool === 'get_price' ? clip(args?.mint, 48) : '';
  const output = publicApiSummary(tool, parsed);
  const label = tool === 'prepare_shopping' && parsed?.provider === 'laso'
    ? 'Laso API'
    : (LABELS[tool] || tool.replaceAll('_', ' '));
  return withFailure({
    kind: 'tool',
    name: tool,
    label: failed ? `${label} failed` : label,
    detail,
    ...(output ? { output } : {}),
    status,
  }, tool, args, parsed, failed);
}

function failureFields(step) {
  const command = clip(step.command, 240).replace(SECRET_VALUE, '[hidden]');
  const error = clip(step.error, step.name === 'request_spend' ? PRIVY_ERROR_LENGTH : 400)
    .replace(SECRET_VALUE, '[hidden]');
  return {
    ...(command ? { command } : {}),
    ...(error ? { error } : {}),
  };
}

function cleanSite(site) {
  const page = publicUrl(site?.url);
  if (!page || page.host !== clip(site?.host, 120)) return null;
  return { title: clip(site?.title, 140), url: page.url, host: page.host };
}

/** Drop anything a stored transcript should not render. */
export function sanitizeActivity(value) {
  if (!Array.isArray(value)) return [];
  const steps = [];
  for (const step of value) {
    if (!step || typeof step !== 'object') continue;
    if (step.kind === 'think') {
      const text = clip(step.text, 800);
      if (text) steps.push({ kind: 'think', text });
    } else if (step.kind === 'search') {
      const sites = (Array.isArray(step.sites) ? step.sites : []).map(cleanSite).filter(Boolean).slice(0, 6);
      const searchStatus = step.status === 'error' ? 'error' : 'done';
      steps.push({
        kind: 'search',
        query: clip(step.query, 160),
        sites,
        status: searchStatus,
        ...(searchStatus === 'error' ? failureFields(step) : {}),
      });
    } else if (step.kind === 'page') {
      const site = cleanSite(step);
      if (!site) continue;
      steps.push({
        kind: 'page',
        label: clip(step.label, 80) || 'Opened a page',
        title: site.title,
        url: site.url,
        host: site.host,
        status: step.status === 'error' ? 'error' : 'done',
      });
    } else if (step.kind === 'tool') {
      const label = clip(step.label, 80);
      if (!label) continue;
      const toolStatus = step.status === 'error' ? 'error' : 'done';
      const output = clip(step.output, 500).replace(SECRET_VALUE, '[hidden]');
      steps.push({
        kind: 'tool',
        name: clip(step.name, 64),
        label,
        detail: clip(step.detail, 80),
        ...(output ? { output } : {}),
        status: toolStatus,
        ...(toolStatus === 'error' ? failureFields(step) : {}),
      });
    }
    if (steps.length >= 12) break;
  }
  const unique = [];
  for (const step of steps) {
    const prev = unique.at(-1);
    if (prev && JSON.stringify(prev) === JSON.stringify(step)) continue;
    unique.push(step);
  }
  return unique;
}
