import { createHmac, timingSafeEqual, createPublicKey, verify } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';

export function parseSwapAuthorization(value) {
  if (!value || typeof value !== 'object' || typeof value.signedTransaction !== 'string'
      || !/^[A-Za-z0-9+/]{80,1644}={0,2}$/.test(value.signedTransaction)
      || typeof value.blockhash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.blockhash)
      || !Number.isSafeInteger(value.expiresAt) || !/^[0-9a-f]{64}$/.test(value.proof ?? '')) return null;
  return value;
}

export function swapAuthorizationProof({ key, ownerId, bot, wallet, id, prepared, blockhash, expiresAt }) {
  return createHmac('sha256', key).update(JSON.stringify([
    'maelstrom:swap-client-sign:v1', ownerId, bot.id, bot.policyVersion, wallet.id, wallet.address,
    id, prepared.transaction, prepared.feeLamports, prepared.maxSolCost, blockhash, expiresAt,
  ])).digest('hex');
}

export function validSwapSignature(authorization, expectedProof, transaction, walletAddress) {
  if (!timingSafeEqual(Buffer.from(expectedProof, 'hex'), Buffer.from(authorization.proof, 'hex'))) return false;
  try {
    const signed = VersionedTransaction.deserialize(Buffer.from(authorization.signedTransaction, 'base64'));
    const unsigned = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
    const message = signed.message.serialize();
    if (!Buffer.from(message).equals(Buffer.from(unsigned.message.serialize()))
        || signed.message.header.numRequiredSignatures !== 1
        || signed.message.staticAccountKeys[0].toBase58() !== walletAddress) return false;
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), signed.message.staticAccountKeys[0].toBuffer()]),
      format: 'der', type: 'spki',
    });
    return verify(null, message, key, signed.signatures[0]);
  } catch { return false; }
}
