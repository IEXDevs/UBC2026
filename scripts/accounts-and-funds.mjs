import { SOLANA_CLUSTER, SOLANA_RPC_URL } from '@ubc2026/contracts/solana';
/**
 * Chunk 0B: where account keys live (names only) and how a person funds
 * Solana mainnet-beta SOL and USDC. Prints steps. Does not read secret values,
 * call faucets, or sign.
 */
import { pathToFileURL } from 'node:url';
import { SECRET_GROUPS, SECRET_NAMES } from '../packages/contracts/contracts.mjs';
import { SOLANA_USDC_MINT } from '../packages/x402/x402.mjs';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const SOL_FAUCET_URL = 'https://faucet.solana.com/';
export const USDC_FAUCET_URL = 'https://faucet.circle.com/?chain=SOL';
export const SOLANA_USDC_MINT_ADDRESS = SOLANA_USDC_MINT;
export const PUBLIC_SOLANA_RPC = SOLANA_RPC_URL;

export class AccountsFundsError extends Error {}

const fail = message => {
  throw new AccountsFundsError(message);
};

export function decodeBase58(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return null;
  const bytes = [0];
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  for (const char of value) {
    if (char !== '1') break;
    leading += 1;
  }
  while (leading > 0) {
    bytes.push(0);
    leading -= 1;
  }
  return Uint8Array.from(bytes.reverse());
}

export function isSolanaAddress(value) {
  const decoded = decodeBase58(value);
  return decoded?.length === 32;
}

export function assertSolanaAddress(value) {
  if (!isSolanaAddress(value)) fail('Pass a Solana wallet address (base58, 32 bytes). This is a public address, not a secret.');
  return value;
}

/**
 * Vendors from chunk 0B. `names` are environment variable names only.
 * Every SECRET_NAMES entry must appear here.
 */
export const ACCOUNT_VENDORS = Object.freeze([
  {
    id: 'privy',
    dashboard: 'https://dashboard.privy.io',
    names: Object.freeze([
      ...SECRET_GROUPS.privy,
      ...SECRET_GROUPS.privyClient,
      'NEXT_PUBLIC_PRIVY_CLIENT_ID',
      'PRIVY_AUTHORIZATION_KEY',
    ]),
    steps: Object.freeze([
      'Create a Privy app at the dashboard.',
      'Enable Email login and Solana embedded wallets. Under Domains, allowlist http://localhost:3000 (with port) for local web.',
      'Put the app id in PRIVY_APP_ID and the app secret in PRIVY_APP_SECRET.',
      'Put the same public app id in NEXT_PUBLIC_PRIVY_APP_ID in the repo root .env.local.',
      'Leave NEXT_PUBLIC_PRIVY_CLIENT_ID empty unless you created an App client and need that client id. A wrong client id makes email login show Something went wrong.',
      'Optional: store the server authorization private key as PRIVY_AUTHORIZATION_KEY (the wallet-auth value from the Privy dashboard). Leave it empty when the app secret alone can sign. Do not commit it.',
      'Leave every value empty in git. The NEXT_PUBLIC_ names are still not committed.',
    ]),
  },
  {
    id: 'supabase',
    dashboard: 'https://supabase.com/dashboard',
    names: Object.freeze([...new Set([...SECRET_GROUPS.supabase, ...SECRET_GROUPS.supabaseClient])]),
    steps: Object.freeze([
      'Create a Supabase project.',
      'From Project Settings → API, copy the project URL, anon key, and service role key into SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.',
      'Do not apply migrations from this script and do not commit the keys.',
    ]),
  },
  {
    id: 'cloudflare',
    dashboard: 'https://dash.cloudflare.com',
    names: SECRET_GROUPS.cloudflare,
    steps: Object.freeze([
      'Copy the account id into CLOUDFLARE_ACCOUNT_ID.',
      'Create an API token and store it as CLOUDFLARE_API_TOKEN.',
      'For the Worker, set the same names with `npx wrangler secret put <NAME>` from apps/agent-runtime. Wrangler prompts for the value; do not pass it on the command line.',
    ]),
  },
  {
    id: 'meta-model',
    dashboard: 'https://dev.meta.ai/',
    names: Object.freeze([...SECRET_GROUPS.metaModel, ...SECRET_GROUPS.openrouter]),
    steps: Object.freeze([
      'Create a Meta Model API key (starts with LLM_) and store it as META_MODEL_API_KEY in root .env.local.',
      'Optional fallback: create an OpenRouter key (sk-or-) as OPENROUTER_API_KEY.',
      'Keys are Authorization headers only. Never put them in the prompt or commit them.',
    ]),
  },
  {
    id: 'firecrawl',
    dashboard: 'https://www.firecrawl.dev/app',
    names: SECRET_GROUPS.firecrawl,
    steps: Object.freeze([
      'Create an API key and store it as FIRECRAWL_API_KEY.',
    ]),
  },
  {
    id: 'quicknode',
    dashboard: 'https://dashboard.quicknode.com',
    names: Object.freeze([
      ...SECRET_GROUPS.quicknode,
      ...SECRET_GROUPS.quicknodePortfolio,
      ...SECRET_GROUPS.quicknodeTestnet,
      ...SECRET_GROUPS.quicknodeWebhook,
    ]),
    steps: Object.freeze([
      'Sign in to QuickNode and claim any hackathon credits from the sponsor instructions.',
      `Create an endpoint with chain Solana and network ${SOLANA_CLUSTER}.`,
      'Store the HTTP provider URL as SOLANA_RPC_URL.',
      `For public read-only fallback, use ${PUBLIC_SOLANA_RPC}. Signing still requires an explicitly configured $SOLANA_RPC_URL.`,
      'On mainnet, the existing QUICKNODE_MAINNET_RPC_URL secret also works when SOLANA_RPC_URL is empty.',
      'QUICKNODE_WEBHOOK_SECRET is for Streams later. Leave it empty until that chunk.',
    ]),
  },
  {
    id: 'elevenlabs',
    dashboard: 'https://elevenlabs.io/app/settings/api-keys',
    names: SECRET_GROUPS.elevenlabs,
    steps: Object.freeze([
      'Create an API key and store it as ELEVENLABS_API_KEY.',
      'When an ElevenAgents agent exists, store its id as ELEVENLABS_AGENT_ID.',
      'Create a shared secret and store it as ELEVENLABS_WEBHOOK_SECRET. ElevenLabs sends it on webhook tool calls and on the custom LLM. The Worker uses it only to authenticate those calls. Tests use a stand-in and do not call ElevenLabs.',
    ]),
  },
  {
    id: 'google-drive',
    dashboard: 'https://console.cloud.google.com/auth/clients',
    names: SECRET_GROUPS.googleDrive,
    steps: Object.freeze([
      'In Google Cloud, enable the Drive API and create a web OAuth client named Maelstrom Drive.',
      'Put the client id and client secret in GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET.',
      'Authorize https://www.googleapis.com/auth/drive.file once and store the refresh token as GOOGLE_DRIVE_REFRESH_TOKEN.',
      'Leave the values empty in git. Do not paste them into chat.',
    ]),
  },
]);

function walletToken(address) {
  return address ?? '<WALLET_ADDRESS>';
}

export function buildAccountsAndFundsPlan({ address } = {}) {
  const wallet = address == null || address === '' ? null : assertSolanaAddress(address);
  const token = walletToken(wallet);
  return {
    storesValues: false,
    networkCalls: false,
    wallet,
    copyEnv: 'cp .env.example .env',
    accounts: ACCOUNT_VENDORS.map(vendor => ({
      id: vendor.id,
      dashboard: vendor.dashboard,
      names: [...vendor.names],
      steps: [...vendor.steps],
    })),
    funds: {
      sol: {
        asset: 'SOL',
        cluster: SOLANA_CLUSTER,
        url: SOLANA_CLUSTER === 'devnet' ? SOL_FAUCET_URL : null,
        steps: SOLANA_CLUSTER === 'devnet' ? [
          `Open ${SOL_FAUCET_URL}`,
          `Paste ${token}. The page allows 2 requests every 8 hours. Signing in with GitHub raises the limit.`,
          'Use test SOL only. Never send real funds to a faucet.',
        ] : [
          `Fund ${token} with real mainnet SOL from a wallet you control.`,
          'Keep enough SOL for transaction fees and token-account rent. Mainnet has no faucet or airdrop.',
          'Verify the network and recipient; begin with a small owner-approved transfer.',
        ],
      },
      usdc: {
        asset: 'USDC',
        cluster: SOLANA_CLUSTER,
        url: SOLANA_CLUSTER === 'devnet' ? USDC_FAUCET_URL : null,
        mint: SOLANA_USDC_MINT_ADDRESS,
        steps: SOLANA_CLUSTER === 'devnet' ? [
          `Open ${USDC_FAUCET_URL}`,
          'Choose Solana and USDC. The public faucet does not need a Circle account or API key.',
          `Paste ${token} and request devnet USDC.`,
          `Confirm the token account uses mint ${SOLANA_USDC_MINT_ADDRESS}.`,
          'Get devnet SOL first. Creating the USDC token account needs a little SOL for rent.',
        ] : [
          `Send real Solana mainnet USDC to ${token} from a wallet you control.`,
          `Verify Circle mint ${SOLANA_USDC_MINT_ADDRESS}; bridged or similarly named tokens are not USDC.`,
          'Fund SOL fees first. Begin with a small owner-approved transfer; transfers are irreversible.',
        ],
      },
    },
  };
}

export function formatAccountsAndFunds(plan) {
  const lines = [
    `Accounts and ${SOLANA_CLUSTER} funds`,
    '',
    'Secret names only. This command does not read secret values or call a faucet.',
    `Local file (gitignored): ${plan.copyEnv}`,
    'Worker: from apps/agent-runtime, `npx wrangler secret put <NAME>` and type the value at the prompt.',
    '',
    'Accounts',
  ];
  for (const vendor of plan.accounts) {
    lines.push('', `${vendor.id}`, `  dashboard: ${vendor.dashboard}`, `  names: ${vendor.names.join(', ')}`);
    for (const step of vendor.steps) lines.push(`  - ${step}`);
  }
  lines.push('', 'Solana SOL', `  ${plan.funds.sol.url}`);
  for (const step of plan.funds.sol.steps) lines.push(`  - ${step}`);
  lines.push('', 'Solana USDC', `  ${plan.funds.usdc.url}`, `  mint: ${plan.funds.usdc.mint}`);
  for (const step of plan.funds.usdc.steps) lines.push(`  - ${step}`);
  if (plan.wallet) lines.push('', `Wallet address: ${plan.wallet}`);
  else lines.push('', 'Pass --address <SOLANA_PUBKEY> to fill the funding steps with a public wallet address.');
  return `${lines.join('\n')}\n`;
}

export function assertSecretNamesCovered() {
  const listed = new Set(ACCOUNT_VENDORS.flatMap(vendor => vendor.names));
  const missing = SECRET_NAMES.filter(name => !listed.has(name));
  if (missing.length > 0) fail(`Account steps are missing secret names: ${missing.join(', ')}`);
}

function parseArgs(argv) {
  const args = { json: false, address: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--address') {
      args.address = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--address=')) args.address = arg.slice('--address='.length);
    else fail(`Unknown argument: ${arg}`);
  }
  if (args.address === undefined && argv.includes('--address')) fail('Pass a Solana wallet address (base58, 32 bytes). This is a public address, not a secret.');
  return args;
}

export function runAccountsAndFunds(argv = []) {
  assertSecretNamesCovered();
  const args = parseArgs(argv);
  const plan = buildAccountsAndFundsPlan({ address: args.address });
  const text = args.json ? `${JSON.stringify(plan, null, 2)}\n` : formatAccountsAndFunds(plan);
  return { plan, text };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const { text } = runAccountsAndFunds(process.argv.slice(2));
    process.stdout.write(text);
  } catch (error) {
    if (error instanceof AccountsFundsError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
