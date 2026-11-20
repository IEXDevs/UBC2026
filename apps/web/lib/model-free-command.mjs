import { parsePlatformSend } from './platform-send.mjs';
import { parseSolHandleSend } from './sol-handle-send.mjs';

// These commands already have non-model routes. This only controls the chat
// input: the existing owner, balance, approval and signing checks still apply.
export function modelFreeCommand(message) {
  if (parsePlatformSend(message)) return 'platform-send';
  if (parseSolHandleSend(message)) return 'sol-send';
  return '';
}

export function needsChatModel(message, grants = []) {
  if (modelFreeCommand(message)) return false;
  // A pending sealed spend is verified by the server, not by another model.
  return !Array.isArray(grants) || !grants.some(grant => grant?.name === 'request_spend'
    && grant.kind === 'modal' && typeof grant.proof === 'string');
}

export function canReleaseChatMessage(message, { hasModel, paymentPending = false }) {
  return !paymentPending && (hasModel || !needsChatModel(message));
}
