/**
 * Laso's live docs, by topic. The agent fetches these itself with web_scrape
 * instead of answering from memory: SKILL.md first, then only the reference
 * the task needs, re-checking the docs-version beacon when the cached copy
 * may be stale. Pure data, no I/O.
 */

export const LASO_SKILL_URL = 'https://laso.finance/SKILL.md';
export const LASO_LLM_URL = 'https://laso.finance/llms.txt';
export const LASO_DOCS_VERSION_URL = 'https://laso.finance/.well-known/docs-version.json';
export const LASO_OPENAPI_URL = 'https://laso.finance/openapi.json';
export const LASO_AGENT_TERMS_URL = 'https://laso.finance/agent-terms.md';

const REF = name => `https://laso.finance/skills/laso-finance/references/${name}.md`;

export const LASO_REFERENCES = Object.freeze({
  payments: REF('payments'),
  cards: REF('cards'),
  giftCards: REF('gift-cards'),
  payouts: REF('payouts'),
  banking: REF('banking'),
  account: REF('account'),
  walletNative: REF('wallet-native'),
});

/**
 * Ordered doc URLs for an owner message. SKILL.md always leads; the
 * task reference follows; the version beacon rides along for freshness.
 */
export function lasoDocsFor(message) {
  const text = typeof message === 'string' ? message : '';
  const docs = [LASO_SKILL_URL];
  if (/\bgift\b/i.test(text)) docs.push(LASO_REFERENCES.giftCards);
  if (/\bvenmo\b|\bpaypal\b|\bpush-to-card\b|\bbank\b|\bpayout\b|\bdebit card\b/i.test(text)) docs.push(LASO_REFERENCES.payouts);
  if (/\bbank\b|\brecipient\b|\bdestination\b/i.test(text)) docs.push(LASO_REFERENCES.banking);
  if (/\bkyc\b|\bverif/i.test(text)) docs.push(LASO_REFERENCES.account);
  if (/\bbalance\b|\bwithdraw\b|\bwebhook\b/i.test(text)) docs.push(LASO_REFERENCES.account);
  if (/\bcard\b|\blaso\b|\blasso\b|\breloadable\b|\bprepaid\b/i.test(text)) docs.push(LASO_REFERENCES.cards);
  if (/\bx402\b|\bpay\b|\bswap\b|\btransfer\b|\btop.?up\b|\bbridge\b|\busdc\b/i.test(text)) docs.push(LASO_REFERENCES.payments);
  if (/\bown wallet\b|\bmpp\b|\blocus\b|\bsponge\b|\bampersend\b/i.test(text)) docs.push(LASO_REFERENCES.walletNative);
  if (docs.length === 1) docs.push(LASO_REFERENCES.payments);
  return { docs: [...new Set(docs)], versionUrl: LASO_DOCS_VERSION_URL };
}
