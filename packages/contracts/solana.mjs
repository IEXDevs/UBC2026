const NETWORKS = Object.freeze({
  'mainnet-beta': Object.freeze({
    genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    streamNetwork: 'solana-mainnet',
    privyChain: 'solana:mainnet',
  }),
  devnet: Object.freeze({
    genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    rpcUrl: 'https://api.devnet.solana.com',
    streamNetwork: 'solana-devnet',
    privyChain: 'solana:devnet',
  }),
});

export function resolveSolanaConfig(cluster = 'mainnet-beta') {
  const name = cluster === 'mainnet' ? 'mainnet-beta' : (cluster || 'mainnet-beta');
  if (!Object.hasOwn(NETWORKS, name)) throw new Error('Unsupported SOLANA_CLUSTER');
  return Object.freeze({ cluster: name, ...NETWORKS[name] });
}

const publicCluster = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SOLANA_CLUSTER : undefined;
const serverCluster = typeof window === 'undefined' && typeof process !== 'undefined' ? process.env.SOLANA_CLUSTER : undefined;
if (serverCluster && publicCluster && resolveSolanaConfig(serverCluster).cluster !== resolveSolanaConfig(publicCluster).cluster) {
  throw new Error('SOLANA_CLUSTER and NEXT_PUBLIC_SOLANA_CLUSTER must match');
}
export const SOLANA_CONFIG = resolveSolanaConfig(serverCluster || publicCluster);
export const SOLANA_CLUSTER = SOLANA_CONFIG.cluster;
export const SOLANA_GENESIS_HASH = SOLANA_CONFIG.genesisHash;
export const SOLANA_CAIP2 = SOLANA_CONFIG.caip2;
export const SOLANA_USDC_MINT = SOLANA_CONFIG.usdcMint;
export const SOLANA_RPC_URL = SOLANA_CONFIG.rpcUrl;
export const SOLANA_STREAM_NETWORK = SOLANA_CONFIG.streamNetwork;
export const SOLANA_PRIVY_CHAIN = SOLANA_CONFIG.privyChain;
export const EXECUTION_LABEL = `${SOLANA_CLUSTER} execution, mainnet pricing`;

export function configuredSolanaRpc(env, cluster = SOLANA_CLUSTER) {
  if ((cluster === 'mainnet-beta' || cluster === 'mainnet') && typeof env?.QUICKNODE_MAINNET_RPC_URL === 'string') {
    const quickNode = env.QUICKNODE_MAINNET_RPC_URL.trim();
    if (quickNode) return quickNode;
  }
  return typeof env?.SOLANA_RPC_URL === 'string' ? env.SOLANA_RPC_URL.trim() : '';
}

export function explorerClusterQuery(cluster = SOLANA_CLUSTER) {
  return cluster === 'mainnet' || cluster === 'mainnet-beta' ? '' : `?cluster=${encodeURIComponent(cluster)}`;
}
