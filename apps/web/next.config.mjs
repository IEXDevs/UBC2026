import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const fromApp = (name) => path.join(appDir, 'node_modules', name);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ubc2026/bot-creation', '@ubc2026/contracts', '@ubc2026/wallets'],
  webpack: (config) => {
    // Privy is hoisted to the repo root, while the Solana peers it imports
    // stay in this app because the root already has a newer @solana/kit.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@solana/kit': fromApp('@solana/kit'),
      '@solana-program/memo': fromApp('@solana-program/memo'),
      '@solana-program/system': fromApp('@solana-program/system'),
      '@solana-program/token': fromApp('@solana-program/token'),
    };
    return config;
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
