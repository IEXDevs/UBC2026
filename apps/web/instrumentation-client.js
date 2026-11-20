import { installAuthFetchTracker } from './lib/deploy-reload.mjs';

// Track and serialize session refreshes before Privy starts restoring a login.
if (typeof window !== 'undefined') installAuthFetchTracker(window);
