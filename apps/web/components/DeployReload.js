'use client';

import { useEffect } from 'react';
import { watchDeploy } from '../lib/deploy-reload.mjs';

/** While a tab is open, a new deployment waits for the Privy session, locks wallet unlocks, and reloads onto that build. */
export default function DeployReload() {
  useEffect(() => watchDeploy({ localId: process.env.NEXT_PUBLIC_BUILD_ID || '' }), []);
  return null;
}
