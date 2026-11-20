export const JUPITER_PLUGIN_SRC = 'https://plugin.jup.ag/plugin-v1.js';
export const JUPITER_SCRIPT_ID = 'jupiter-plugin-script';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function jupiterSwapStatus({ cluster, address, frozen = false, canSign = false } = {}) {
  if (cluster !== 'mainnet-beta') return 'not_mainnet';
  if (typeof address !== 'string' || !ADDRESS.test(address)) return 'no_wallet';
  if (frozen) return 'frozen';
  return canSign ? 'ready' : 'no_signer';
}

export const JUPITER_STATUS_NOTE = Object.freeze({
  not_mainnet: 'Jupiter swaps run on Solana mainnet only.',
  no_wallet: 'Pick a wallet to swap from.',
  frozen: 'This wallet is frozen. Swaps stay off.',
  no_signer: 'Connect this wallet in the browser to sign swaps. Quotes still load.',
  ready: 'Your wallet asks you to approve each swap.',
});

function publicKeyFor(address) {
  return Object.freeze({
    toBase58: () => address,
    toString: () => address,
    toJSON: () => address,
    equals: other => String(other?.toBase58?.() ?? other) === address,
  });
}

export function signingError(cause) {
  const error = new Error('Transaction cancelled');
  error.name = 'WalletSignTransactionError';
  error.cause = cause;
  return error;
}

// Shapes the selected wallet as the wallet-adapter context Jupiter Plugin reads in passthrough mode.
export function passthroughWallet({ address, name = 'Maelstrom wallet', icon = '', signBytes = null } = {}) {
  const signable = typeof signBytes === 'function' && typeof address === 'string' && ADDRESS.test(address);
  if (!signable) {
    return {
      publicKey: null,
      wallet: null,
      wallets: [],
      connected: false,
      connecting: false,
      disconnecting: false,
      autoConnect: false,
    };
  }
  const publicKey = publicKeyFor(address);
  const adapter = {
    name,
    icon,
    url: '',
    publicKey,
    connected: true,
    connecting: false,
    readyState: 'Installed',
    disconnect: async () => {},
  };
  async function signTransaction(transaction) {
    const unsigned = transaction?.serialize?.();
    if (!(unsigned instanceof Uint8Array)) throw signingError();
    let signed;
    try {
      signed = await signBytes(unsigned);
    } catch (error) {
      throw signingError(error);
    }
    if (!(signed instanceof Uint8Array) || signed.length <= 64) throw signingError();
    const Signed = transaction.constructor;
    if (typeof Signed?.deserialize === 'function') return Signed.deserialize(signed);
    return { serialize: () => signed };
  }
  return {
    publicKey,
    wallet: { adapter, readyState: 'Installed' },
    wallets: [],
    connected: true,
    connecting: false,
    disconnecting: false,
    autoConnect: false,
    signTransaction,
    signAllTransactions: async list => Promise.all(list.map(signTransaction)),
  };
}

export function loadJupiterPlugin(doc = globalThis.document) {
  const win = doc?.defaultView || globalThis.window;
  if (win?.Jupiter?.init) return Promise.resolve(win.Jupiter);
  if (!doc) return Promise.reject(new Error('no_document'));
  return new Promise((resolve, reject) => {
    let script = doc.getElementById(JUPITER_SCRIPT_ID);
    if (!script) {
      script = doc.createElement('script');
      script.id = JUPITER_SCRIPT_ID;
      script.src = JUPITER_PLUGIN_SRC;
      script.async = true;
      script.setAttribute('data-preload', '');
      doc.head.appendChild(script);
    }
    script.addEventListener('load', () => (win?.Jupiter?.init ? resolve(win.Jupiter) : reject(new Error('jupiter_missing'))), { once: true });
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error('jupiter_unavailable'));
    }, { once: true });
  });
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export function swapPair(inputMint, usdcMint) {
  const input = typeof inputMint === 'string' && ADDRESS.test(inputMint) ? inputMint : usdcMint;
  return { initialInputMint: input, initialOutputMint: input === SOL_MINT ? usdcMint : SOL_MINT };
}

export function swapReceipt({ signature, walletLabel = '', at = new Date().toISOString(), cluster = 'mainnet-beta' } = {}) {
  if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature)) return null;
  return {
    id: `swap_${signature}`,
    at,
    title: 'Jupiter swap',
    lines: [
      { label: 'From', value: walletLabel || 'Wallet' },
      { label: 'Route', value: 'Jupiter Ultra' },
      { label: 'Signature', value: signature },
      { label: 'Network', value: 'Solana mainnet' },
    ],
    signature,
    cluster,
  };
}
