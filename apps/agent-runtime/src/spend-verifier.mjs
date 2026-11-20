/**
 * Server-side spend check. It rebuilds the trade facts from the proposal
 * and the parsed spend. It does not read a client-supplied verifier payload,
 * and it has no UI.
 */
const AMOUNT = /^(?:0|[1-9][0-9]{0,39})$/;

function units(value) {
  return typeof value === 'string' && AMOUNT.test(value) ? value : '';
}

/**
 * Facts the verifier stands behind. A mismatch on amount, cluster, asset,
 * or recipient returns a different amount so consensus fails closed.
 */
export function verifierFacts({ facts, proposal, parsed, trustScore, mint, trustUnavailable = false } = {}) {
  const unavailable = trustUnavailable === true || facts?.trustUnavailable === true;
  const proposedAmount = units(proposal?.outflow);
  const requested = units(parsed?.amount ?? facts?.amount);
  const cluster = proposal?.cluster === 'devnet' || proposal?.cluster === 'testnet' ? proposal.cluster : '';
  const expectedAsset = parsed?.asset ?? facts?.asset ?? 'USDC';
  const asset = proposal?.asset === expectedAsset ? expectedAsset : '';
  const recipient = typeof proposal?.recipient === 'string' ? proposal.recipient : '';
  const expectedRecipient = parsed?.destination || parsed?.handle || recipient;
  const score = unavailable ? '' : units(trustScore ?? facts?.trustScore);
  const price = units(facts?.price) || '1000000';
  const token = typeof (mint || facts?.mint) === 'string' ? (mint || facts.mint) : '';
  const aligned = Boolean(
    proposedAmount
    && requested
    && proposedAmount === requested
    && cluster
    && asset
    && recipient
    && recipient === expectedRecipient
    && (unavailable || score)
    && token
    && (facts?.cluster == null || facts.cluster === cluster)
    && (facts?.asset == null || facts.asset === asset),
  );
  const verified = {
    asset: expectedAsset,
    mint: token || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    cluster: cluster || 'devnet',
    price,
    amount: aligned ? requested : (facts?.amount === '1' ? '0' : '1'),
    reasonSummary: aligned
      ? `verify ${requested} ${expectedAsset} on ${cluster}`
      : 'verify refused the proposal',
  };
  if (unavailable) verified.trustUnavailable = true;
  else verified.trustScore = score || '800';
  return verified;
}
