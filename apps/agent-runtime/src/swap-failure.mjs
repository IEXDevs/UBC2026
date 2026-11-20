import { swapSimulationDetails } from '@ubc2026/wallets/swap-diagnostics';

const FAILURES = {
  client_sign_required: ['client signing', 'Approve this swap in the browser with the selected wallet.'],
  aborted: ['client signing', 'The swap request was cancelled. Nothing further was submitted.'],
  client_sign_rejected: ['client signing', 'The selected wallet declined or cancelled signing.'],
  wallet_connection_required: ['client signing', 'The selected wallet is not available in this browser. Connect that exact wallet; server-only wallets cannot use browser signing.'],
  broadcast_failed: ['broadcast', 'The server could not broadcast the signed swap. Submission status may be unknown; check activity before retrying.'],
  swap_quote_unavailable: ['quote', 'Jupiter could not prepare a swap quote.'],
  jupiter_quote_timeout: ['quote', 'Jupiter did not return a swap quote before the request timed out.'],
  jupiter_quote_transport: ['quote', 'The Worker could not complete the request to Jupiter.'],
  jupiter_redirect_refused: ['quote', 'Jupiter redirected the quote request. The Worker stopped before sending the API key to another URL.'],
  jupiter_quote_invalid_response: ['quote', 'Jupiter did not return a valid swap response.'],
  swap_route_refused: ['quote validation', 'The Jupiter route failed the transaction safety checks. Try a different amount or pair.'],
  swap_mint_invalid: ['mint metadata', 'The mint address, network, or decimals could not be verified.'],
  insufficient_funds: ['simulation', 'The wallet needs enough input tokens and SOL for fees and account rent.'],
  account_not_found: ['simulation', 'A required wallet or token account was not found.'],
  swap_owner_authorization_required: ['approval', 'Approve this swap with the owner wallet.'],
  spend_authorization_expired: ['approval', 'The wallet authorization expired. Request a fresh swap.'],
  spend_authorization_changed: ['approval', 'The transaction changed after wallet authorization. Request a fresh swap.'],
  invalid_spend_authorization: ['approval', 'The owner wallet authorization is invalid.'],
  wallet_authorization_unavailable: ['Privy signing', 'The wallet authorization service is not configured.'],
  'over-budget': ['budget', 'The swap exceeds the agent spending budget.'],
  'approval-save-failed': ['budget', 'The budget approval could not be saved.'],
  context_missing: ['context', 'The agent wallet or spending ledger could not be loaded.'],
  owner_mismatch: ['permission', 'The agent and wallet must belong to the signed-in owner.'],
  invalid_spend: ['validation', 'The swap request has invalid or missing fields.'],
  transfer_preparation_failed: ['preparation', 'The swap transaction could not be prepared.'],
  unsupported_mint: ['mint metadata', 'This token mint is not supported.'],
  'signer-not-configured': ['Privy signing', 'A wallet signing client is not configured.'],
  invalid_signature: ['Privy signing', 'The wallet returned an invalid signature.'],
  invalid_transaction: ['transaction validation', 'The transaction was invalid or exceeded Solana limits.'],
  owner_auth_required: ['permission', 'Sign in as the wallet owner before swapping.'],
  invalid_authorization_key: ['Privy signing', 'The configured signing authorization key is invalid.'],
  invalid_wallet: ['Privy signing', 'The wallet has no valid signing identity.'],
  transaction_mismatch: ['Privy signing', 'The signed transaction did not match the simulated swap.'],
  simulation_required: ['simulation', 'A verified simulation is required before signing.'],
  swap_quote_expired: ['quote', 'The quote expired or changed. Request a fresh quote.'],
  swap_unavailable: ['quote', 'Swap execution is not configured (Jupiter key, wallet client, or budget service).'],
  swap_intent_unavailable: ['intent', 'This swap is no longer pending or its terms changed.'],
  'trust-confirmation-required': ['trust', 'This token needs explicit owner approval because its trust score is low.'],
  'trust-unavailable': ['trust', 'The token trust score could not be verified.'],
  'approval-needed': ['approval', 'The review threshold requires owner approval.'],
  owner_approval_required: ['permission', 'Ask-every-time permission requires owner approval.'],
  invalid_auto_swap: ['permission', 'Automatic execution requires Full or Review permission and a queued swap.'],
  desk_locked: ['desk lock', 'Unlock the desk before approving this swap.'],
  desk_lock_unavailable: ['desk lock', 'The desk lock service is unavailable.'],
  'per-transaction': ['budget', 'The swap exceeds the per-transaction budget.'],
  'total-outflow': ['budget', 'The swap exceeds the remaining budget.'],
  'max-loss-reached': ['budget', 'The agent reached its loss limit.'],
  'reserve-failed': ['budget', 'The budget could not be reserved.'],
  'duplicate-spend': ['budget', 'This swap was already attempted. Check activity before retrying.'],
  swap_requires_usd_budget: ['budget', 'This agent needs USD spending limits for swaps.'],
  simulation_failed: ['simulation', 'The transaction simulation failed or its wallet effects did not match the quote.'],
  swap_simulation_unavailable: ['simulation', 'The RPC did not return the account snapshots needed to verify this swap.'],
  usd_price_unavailable: ['valuation', 'A current USD price could not be obtained.'],
  wrong_cluster: ['network', 'The RPC network does not match Solana mainnet.'],
  'spend-frozen': ['wallet', 'The agent or wallet is frozen or disabled.'],
  wallet_owner_session_required: ['Privy signing', 'Sign in again as the wallet owner.'],
  wallet_authorization_failed: ['Privy signing', 'Privy rejected the wallet authorization.'],
  wallet_policy_rejected: ['Privy signing', 'The Privy wallet policy rejected this swap.'],
  privy_failed: ['Privy signing', 'Privy could not sign the swap.'],
  'sign-rejected': ['Privy signing', 'The signing service returned no valid signature.'],
  rpc_failed: ['broadcast', 'The RPC request failed. Submission status is unknown; check activity before retrying.'],
  rpc_rejected: ['broadcast', 'The RPC did not return a transaction signature. Check activity before retrying.'],
  confirmation_failed: ['confirmation', 'The swap did not confirm. Check the transaction in the explorer before retrying.'],
  plugin_load_failed: ['Jupiter plugin', 'The Jupiter plugin could not load.'],
  plugin_swap_failed: ['Jupiter execution', 'Jupiter reported a swap failure without a recognized error code. Check activity before retrying.'],
  wallet_rejected: ['Privy signing', 'The wallet declined or cancelled signing.'],
  'verify-mismatch': ['verification', 'The independent verifier did not agree with the swap.'],
  swap_failed: ['swap service', 'The swap service failed without a recognized error code. Check activity before retrying.'],
};

export function swapFailure(result = {}) {
  if (result === null || typeof result !== 'object') result = {};
  const provider = [result.error, result.code].find(value => /^jupiter_http_[45][0-9]{2}$/.test(value ?? ''));
  if (provider) return { code: provider, step: 'quote', message: `Swap — quote: Jupiter returned HTTP ${provider.slice(-3)}. Check API access or retry later. [${provider}]` };
  const instruction = [result.simulationReason, result.error].find(value => /^instruction_[0-9]+_(?:[A-Za-z]{1,64}|custom_[0-9]+|unknown)$/.test(value ?? ''));
  if (instruction) {
    const details = swapSimulationDetails(result.simulationDetails ?? result.failure?.simulationDetails);
    const lines = [`Swap — simulation: A Solana instruction failed before broadcast. [${instruction}]`];
    if (details?.instructionProgram) lines.push(`Instruction program ${details.instructionProgram}.`);
    if (details) lines.push(...details.logs);
    return { code: instruction, step: 'simulation', message: lines.join('\n'), ...(details ? { simulationDetails: details } : {}) };
  }
  const code = [result.simulationReason, result.reason, result.error, result.state, result.code]
    .find(value => Object.hasOwn(FAILURES, value)) || 'swap_failed';
  const [step, reason] = FAILURES[code];
  return { code, step, message: `Swap — ${step}: ${reason} [${code}]` };
}
