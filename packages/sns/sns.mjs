/**
 * SNS (.sol) resolve + send-intent helpers (Isaac / chunk 6C).
 * Resolution is injectable; no mainnet execution.
 */
export class SnsError extends Error {}
const fail = message => { throw new SnsError(message); };

const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const domainOk = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,62}\.sol$/i.test(value);

export function normalizeSnsName(name) {
  if (!domainOk(name)) fail('SNS name must look like alex.sol');
  return name.trim().toLowerCase();
}

export function createSnsResolver({ resolveFn }) {
  if (typeof resolveFn !== 'function') fail('resolveFn is required');
  return async function resolve(name) {
    const domain = normalizeSnsName(name);
    const address = await resolveFn(domain);
    if (typeof address !== 'string' || !base58.test(address)) fail('SNS resolver returned an invalid pubkey');
    return { domain, address, clusterRead: 'mainnet-read', executionCluster: 'devnet' };
  };
}

export function buildSnsTransferIntent({
  from,
  domain,
  to,
  amount,
  asset = 'USDC',
  botId,
  memo,
}) {
  if (!base58.test(from) || !base58.test(to)) fail('Invalid transfer pubkeys');
  if (!domainOk(domain)) fail('SNS name must look like alex.sol');
  if (typeof amount !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(amount)) fail('Invalid amount');
  if (typeof botId !== 'string' || !botId) fail('botId is required');
  return {
    type: 'sns-transfer',
    domain: normalizeSnsName(domain),
    from,
    to,
    amount,
    asset,
    botId,
    cluster: 'devnet',
    memo: memo ?? `maelstrom:sns:${normalizeSnsName(domain)}`,
    status: 'unsigned',
  };
}
