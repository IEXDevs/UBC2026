import { parsePrivySigningFailure } from '@ubc2026/contracts';

export function walletSendFailure(message, failure = {}) {
  const code = typeof failure?.error === 'string' && /^[a-z0-9_]{1,64}$/.test(failure.error)
    ? failure.error : 'send_failed';
  const privy = parsePrivySigningFailure(failure?.privy);
  const details = privy ? [
    [privy.status, privy.code, privy.transport].filter(Boolean).join(' '),
    ...(privy.requests || []).map(request => [request.stage, request.status, request.code,
      request.transport, request.detail, request.requestId].filter(Boolean).join(' ')),
    privy.session?.check ? `session: ${privy.session.check}` : '',
  ].filter(Boolean).join(' · ') : '';
  return { ok: false, message: `${message} Code: ${code}${details ? ` · Privy: ${details}` : ''}` };
}
