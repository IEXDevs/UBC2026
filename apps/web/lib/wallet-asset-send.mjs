import { PublicKey, Transaction } from '@solana/web3.js';
import { buildWalletAssetTransaction } from '@ubc2026/transfers';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

export async function sendWalletAsset({ client, ownerId, from, wallets, destination, asset, amount, decimals, phase, signedTransaction } = {}) {
  if (!from || from.ownerId !== ownerId) fail('wallet_not_owned');
  if (from.frozen) fail('wallet_frozen');
  if (typeof amount !== 'string' || !/^[1-9][0-9]{0,19}$/.test(amount) || BigInt(amount) > 18446744073709551615n) fail('invalid_amount');
  if (typeof asset !== 'string' || (asset !== 'SOL' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(asset))) fail('invalid_mint');
  if (typeof destination !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destination)) fail('invalid_destination');
  try { new PublicKey(destination); } catch { fail('invalid_destination'); }
  if (destination === from.address) fail('invalid_destination');
  const ownDestination = wallets.find(wallet => wallet?.address === destination);
  if (ownDestination?.frozen) fail('wallet_frozen');
  const connected = from.spendable === false;
  if (connected && ownDestination?.kind !== 'main') fail('invalid_destination');
  if ((connected && !['prepare', 'broadcast'].includes(phase)) || (!connected && phase !== 'send')) fail('invalid_phase');
  let signed;
  if (phase === 'broadcast') {
    try {
      if (typeof signedTransaction !== 'string' || signedTransaction.length > 2000) fail('invalid_signature');
      signed = Transaction.from(Buffer.from(signedTransaction, 'base64'));
      if (!signed.verifySignatures()) fail('invalid_signature');
    } catch { fail('invalid_signature'); }
  }
  const balance = await client.readSolanaAsset({ address: from.address, asset });
  if (decimals !== balance.decimals) fail('asset_changed');
  if (BigInt(balance.amount) < BigInt(amount)) fail('insufficient_balance');
  const block = signed ? { blockhash: signed.recentBlockhash, cluster: SOLANA_CLUSTER } : await client.getSolanaBlockhash();
  if (block.cluster !== SOLANA_CLUSTER) fail('wrong_cluster');
  const transaction = buildWalletAssetTransaction({
    asset, decimals: balance.decimals, tokenProgramId: balance.tokenProgramId, accounts: balance.accounts,
    sourceOwner: from.address, destinationOwner: destination, amount, recentBlockhash: block.blockhash,
  });
  if (signed && !signed.serializeMessage().equals(Transaction.from(Buffer.from(transaction, 'base64')).serializeMessage())) fail('transaction_mismatch');
  const prepared = await client.prepareSolanaTransfer({ transaction });
  if (connected && phase === 'prepare') return { ok: true, transaction, cluster: SOLANA_CLUSTER };
  const sent = connected
    ? await client.broadcastSignedSolana({ signedTransaction })
    : await client.signPreparedOwnerSolana({ ownerId, wallet: from, prepared });
  if (sent?.cluster !== SOLANA_CLUSTER || typeof sent.signature !== 'string') fail('wrong_cluster');
  return { ok: true, signature: sent.signature, address: destination, asset, amount, cluster: SOLANA_CLUSTER };
}
