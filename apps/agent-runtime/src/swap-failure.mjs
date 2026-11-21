import { SYSTEM_PROGRAM, swapSetupNeedsSol, swapSimulationDetails } from '@ubc2026/wallets/swap-diagnostics';

const FAILURES = {
  client_sign_required: ['client signing', 'Approve this swap in the browser with the selected wallet.'],
  swap_delegation_unavailable: ['wallet authorization', 'This wallet is unavailable for automatic signing. Approve the swap with the selected wallet or enable its Privy signer.'],
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
  swap_quote_terms_mismatch: ['quote validation', 'The Jupiter quote failed the check for the requested tokens, input amount, slippage, or minimum output.'],
  swap_route_extra_instructions: ['quote validation', 'Jupiter added a tip or an extra instruction outside the permitted swap steps.'],
  swap_route_compute_invalid: ['quote validation', 'The route included an unsupported compute budget instruction.'],
  swap_route_instruction_mismatch: ['quote validation', 'Maelstrom could not match the Jupiter swap instruction to the quoted terms and wallet.'],
  swap_route_setup_invalid: ['quote validation', 'Maelstrom could not verify a token account or SOL transfer in the route setup.'],
  swap_route_cleanup_invalid: ['quote validation', 'Maelstrom could not verify the route’s wrapped SOL cleanup.'],
  swap_route_signers_invalid: ['quote validation', 'The route required an unexpected additional signer.'],
  swap_route_too_large: ['quote validation', 'The route is too large for one Solana transaction.'],
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
  transaction_mismatch: ['Privy signing', 'Privy returned a changed transaction or an invalid signature. The swap stopped before broadcast.'],
  simulation_required: ['simulation', 'A verified simulation is required before signing.'],
  swap_quote_expired: ['quote', 'The quote expired or changed. Request a fresh quote.'],
  swap_unavailable: ['quote', 'Swap execution is not configured (Jupiter key, wallet client, or budget service).'],
  swap_intent_unavailable: ['intent', 'This swap is no longer pending or its terms changed.'],
  'trust-confirmation-required': ['trust', 'This token needs explicit owner approval because its trust score is low.'],
  'trust-unavailable': ['trust', 'The token trust score could not be verified.'],
  'approval-needed': ['approval', 'The review threshold requires owner approval.'],
  owner_approval_required: ['permission', 'Ask-every-time permission requires owner approval.'],
  invalid_auto_swap: ['permission', 'Automatic execution requires a valid swap quote and Full permissions, or a queued swap in Review by AI.'],
  swap_saved_permission_required: ['permission', 'The Worker could not verify that Full permissions and a review limit are saved for this desk. Approve this swap to continue.'],
  swap_quote_requires_confirmation: ['approval', 'This quote requires owner approval. Review the quoted amount before continuing.'],
  desk_locked: ['desk lock', 'Unlock the desk before approving this swap.'],
  desk_lock_unavailable: ['desk lock', 'The desk lock service is unavailable.'],
  'per-transaction': ['budget', 'The swap exceeds the per-transaction budget.'],
  'total-outflow': ['budget', 'The swap exceeds the remaining budget.'],
  'max-loss-reached': ['budget', 'The agent reached its loss limit.'],
  'reserve-failed': ['budget', 'The budget could not be reserved.'],
  'duplicate-spend': ['budget', 'This swap was already attempted. Check activity before retrying.'],
  swap_requires_usd_budget: ['budget', 'This agent needs USD spending limits for swaps.'],
  simulation_failed: ['simulation', 'Preflight stopped the swap before broadcast. No specific failure reason was available.'],
  simulation_unavailable: ['simulation', 'The RPC returned no usable simulation result. The swap stopped before broadcast.'],
  swap_simulation_unavailable: ['simulation', 'The RPC did not return the account snapshots needed to verify this swap.'],
  swap_lookup_table_unavailable: ['simulation', 'The RPC did not return a required address lookup table for this route.'],
  swap_blockhash_not_found: ['simulation', 'Solana could not find the transaction’s recent blockhash. Request a fresh quote.'],
  swap_effects_unverifiable: ['simulation', 'Maelstrom could not verify the wallet balance changes from the simulation.'],
  swap_fee_unavailable: ['simulation', 'Maelstrom could not verify the SOL fee or cost for this transaction.'],
  swap_wrapped_sol_changed: ['simulation', 'The swap would leave the wallet with a different wrapped SOL balance.'],
  swap_other_token_changed: ['simulation', 'The swap would change the balance of a token outside the quoted pair.'],
  swap_input_mismatch: ['simulation', 'The wallet’s simulated token debit differs from the quoted input amount.'],
  swap_output_below_minimum: ['simulation', 'The wallet would receive less than the quote’s minimum output.'],
  swap_sol_debit_below_fee: ['simulation', 'The simulated SOL debit does not cover the quoted input and network fee.'],
  swap_sol_cost_above_limit: ['simulation', 'The simulated SOL cost exceeds the limit for fees and account setup.'],
  swap_transaction_mismatch: ['simulation', 'The prepared transaction differs from the quoted transaction.'],
  swap_approved_cost_missing: ['simulation', 'The approved quote has no valid SOL cost limit. Request a fresh quote.'],
  swap_approved_cost_exceeded: ['simulation', 'The simulated SOL cost exceeds the amount in the approved quote. Request a fresh quote.'],
  usd_price_unavailable: ['valuation', 'A current USD price could not be obtained.'],
  wrong_cluster: ['network', 'The RPC network does not match Solana mainnet.'],
  'spend-frozen': ['wallet', 'The agent or wallet is frozen or disabled.'],
  wallet_owner_session_required: ['Privy signing', 'Sign in again as the wallet owner.'],
  wallet_authorization_required: ['Privy signing', 'Privy did not accept the configured signer for this wallet. The swap stopped before broadcast.'],
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
    let reason = 'A Solana instruction failed before broadcast.';
    if (instruction.endsWith('_custom_1')) {
      if (swapSetupNeedsSol(details)) {
        reason = 'The sending wallet did not have enough SOL to create a token account for this route. The swap stopped before broadcast.';
      } else if (details?.instructionProgram === SYSTEM_PROGRAM) {
        reason = 'The sending wallet ran short of SOL during swap setup. The wallet must cover the swap input, fees, and any account rent. The swap stopped before broadcast.';
      }
    }
    const lines = [`Swap — simulation: ${reason} [${instruction}]`];
    if (details?.instructionProgram) lines.push(`Instruction program ${details.instructionProgram}.`);
    if (details) lines.push(...details.logs);
    return { code: instruction, step: 'simulation', message: lines.join('\n'), ...(details ? { simulationDetails: details } : {}) };
  }
  const code = [result.simulationReason, result.reason, result.error, result.state, result.code]
    .find(value => Object.hasOwn(FAILURES, value)) || 'swap_failed';
  const [step, reason] = FAILURES[code];
  return { code, step, message: `Swap — ${step}: ${reason} [${code}]` };
}
