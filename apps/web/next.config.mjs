import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import { applyRootPublicEnv } from './lib/root-env.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const fromApp = (name) => path.join(appDir, 'node_modules', name);

// Root `.env.local` holds NEXT_PUBLIC_* for the monorepo; Next would otherwise
// only read apps/web/.env*. Apply before the config object is used.
applyRootPublicEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@ubc2026/bot-creation',
    '@ubc2026/browser-search',
    '@ubc2026/browser-session',
    '@ubc2026/contracts',
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
