'use client';

import { useEffect } from 'react';
import { watchDeploy } from '../lib/deploy-reload.mjs';

/** While a tab is open, a new deployment clears caches and hard-reloads onto that build. */
export default function DeployReload() {
  useEffect(() => watchDeploy({ localId: process.env.NEXT_PUBLIC_BUILD_ID || '' }), []);
  return null;
}
