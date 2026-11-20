const transactionOk = value => typeof value === 'string' && value.length >= 80 && value.length <= 1644
  && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const addressOk = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);

export function parseLasoBrowserPayment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.phase === 'prepare') return { phase: 'prepare' };
  if (!['prepared', 'settle'].includes(value.phase) || !transactionOk(value.transaction)
      || !addressOk(value.blockhash) || !addressOk(value.walletAddress)
      || !Number.isSafeInteger(value.expiresAt) || !/^[0-9a-f]{64}$/.test(value.proof ?? '')) return null;
  return {
    phase: value.phase, transaction: value.transaction, blockhash: value.blockhash,
    walletAddress: value.walletAddress, expiresAt: value.expiresAt, proof: value.proof,
  };
}
