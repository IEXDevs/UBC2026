/**
 * Hidden second-agent verdict for any main-agent step.
 * The owner never sees this role. A missing or unclear verdict does not allow the step.
 */

export const TURN_VERIFY_MARK = 'Role: turn-verify';
export const BLOCKED_TURN = 'That step did not pass the check.';

export function parseTurnVerdict(text) {
  const raw = typeof text === 'string' ? text : '';
  const match = raw.match(/\{\s*"allow"\s*:\s*(true|false)\s*\}/);
  if (!match) return { allow: false };
  return { allow: match[1] === 'true' };
}

export function turnVerifyTask(kind, detail) {
  const body = typeof detail === 'string' ? detail : JSON.stringify(detail ?? '');
  return [
    TURN_VERIFY_MARK,
    'You are the hidden verifier for one Maelstrom agent step. You do not talk to the owner and you do not call tools.',
    'Allow the step only when it stays inside platform rules: devnet or testnet execution, no seed, no private key, no API key, and no mainnet signature.',
    'Reply with JSON only: {"allow":true} or {"allow":false}.',
    `Kind: ${typeof kind === 'string' ? kind.slice(0, 40) : 'step'}`,
    `Step: ${body.slice(0, 4000)}`,
  ].join('\n');
}
