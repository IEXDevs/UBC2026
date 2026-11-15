'use client';

import { installAcceptTermsAuth } from '../lib/accept-terms-auth.mjs';

// instrumentation-client.js installs first; this is a safe second pass after
// the client graph loads (idempotent).
if (typeof window !== 'undefined') installAcceptTermsAuth(window);

export default function AcceptTermsAuth() {
  return null;
}
