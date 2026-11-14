'use client';

import { installAcceptTermsAuth } from '../lib/accept-terms-auth.mjs';

if (typeof window !== 'undefined') installAcceptTermsAuth(window);

export default function AcceptTermsAuth() {
  return null;
}
