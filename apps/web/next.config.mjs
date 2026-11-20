import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import { resolveBuildId } from './lib/build-id.mjs';
import { applyRootPublicEnv, readRootEnv } from './lib/root-env.mjs';
import { publicDevPreviewValue } from './lib/sign-in-gate.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const fromApp = (name) => path.join(appDir, 'node_modules', name);

// Root `.env.local` holds NEXT_PUBLIC_* for the monorepo; Next would otherwise
// only read apps/web/.env*. Apply before the config object is used.
applyRootPublicEnv();
const executionCluster = readRootEnv('SOLANA_CLUSTER') || readRootEnv('NEXT_PUBLIC_SOLANA_CLUSTER') || 'mainnet-beta';
process.env.SOLANA_CLUSTER = executionCluster;

const buildId = resolveBuildId();
// DEV_PREVIEW=1 in the root env shows the developer bypass on the login page.
// Production builds drop it even if the variable is set.
const devPreview = publicDevPreviewValue({ devPreview: readRootEnv('DEV_PREVIEW') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_SOLANA_CLUSTER: readRootEnv('NEXT_PUBLIC_SOLANA_CLUSTER') || executionCluster,
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_DEV_PREVIEW: devPreview,
  },
  reactStrictMode: true,
  transpilePackages: [
    '@ubc2026/bot-creation',
    '@ubc2026/browser-search',
    '@ubc2026/browser-session',
    '@ubc2026/contracts',
    '@ubc2026/prices',
    '@ubc2026/sns',
    '@ubc2026/transfers',
    '@ubc2026/wallets',
  ],
  webpack: (config) => {
    // Privy is hoisted to the repo root, while the Solana peers it imports
    // stay in this app because the root already has a newer @solana/kit.
    // Optional Privy peers we never call (Farcaster mini-app, Abstract AGW,
    // permissionless) still appear as static imports — resolve them to empty
    // modules so webpack does not warn on every compile.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@solana/kit': fromApp('@solana/kit'),
      '@solana-program/memo': fromApp('@solana-program/memo'),
      '@solana-program/system': fromApp('@solana-program/system'),
      '@solana-program/token': fromApp('@solana-program/token'),
      '@farcaster/mini-app-solana': false,
      '@abstract-foundation/agw-client': false,
      '@abstract-foundation/agw-client/actions': false,
      permissionless: false,
      'permissionless/accounts': false,
      'permissionless/clients/pimlico': false,
    };
    return config;
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
