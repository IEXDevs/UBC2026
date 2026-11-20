import { parseLasoBrowserPayment } from '../../agent-runtime/src/laso-browser-payment.mjs';

export async function submitLasoChatPayment({ send, sign, unlock, signal, now = Date.now }) {
  const stopped = () => signal.aborted;
  const aborted = { ok: false, error: 'aborted' };
  if (stopped()) return aborted;
  if (typeof sign !== 'function') return { ok: false, error: 'browser_wallet_required' };
  async function post(payment) {
    if (stopped()) return aborted;
    const result = await send(undefined, payment);
    if (result?.error !== 'desk_locked' || !unlock || stopped()) return result;
    const opened = await unlock(signal);
    if (stopped()) return aborted;
    return opened ? send(undefined, payment) : { ok: false, error: 'unlock_cancelled' };
  }
  const result = await post({ phase: 'prepare' });
  const payment = parseLasoBrowserPayment(result?.lasoPayment);
  if (result?.lasoPayment && (!payment || payment.phase !== 'prepared')) return { ok: false, error: 'invalid_laso_payment' };
  if (!payment || payment.phase !== 'prepared') return result;
  if (stopped()) return aborted;
  if (payment.expiresAt <= now()) return { ok: false, error: 'laso_payment_expired' };
  let signed;
  try {
    const transaction = Uint8Array.from(atob(payment.transaction), byte => byte.charCodeAt(0));
    signed = await sign({ walletAddress: payment.walletAddress, transaction });
  } catch {
    return { ok: false, error: stopped() ? 'aborted' : 'browser_wallet_authorization_failed' };
  }
  if (stopped()) return aborted;
  if (payment.expiresAt <= now()) return { ok: false, error: 'laso_payment_expired' };
  if (!(signed instanceof Uint8Array) || signed.length <= 64 || signed.length > 1232) {
    return { ok: false, error: 'browser_wallet_authorization_failed' };
  }
  const transaction = btoa(String.fromCharCode(...signed));
  return post({ ...payment, phase: 'settle', transaction });
}
