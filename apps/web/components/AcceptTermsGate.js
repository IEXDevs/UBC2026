'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  installAcceptTermsAuth,
  postAcceptTerms,
  readPrivyCaId,
  resolveAcceptTermsToken,
  resolvePrivyRefreshToken,
  withPrivyLogout,
} from '../lib/accept-terms-auth.mjs';

if (typeof window !== 'undefined') installAcceptTermsAuth(window);

/**
 * Privy's Accept screen posts with no session bearer: getAccessToken() drops
 * privy:pat, and the customer token in privy:token is not a session.
 * Hide that modal and POST accept_terms with the privy access token.
 */
export default function AcceptTermsGate({ children }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const needsTerms = ready && authenticated && user && user.hasAcceptedTerms === false;

  async function onDecline() {
    await withPrivyLogout(window, async () => {
      await logout?.();
    });
  }

  useEffect(() => {
    if (!needsTerms) return undefined;
    document.body.classList.add('maelstrom-terms-gate');
    return () => document.body.classList.remove('maelstrom-terms-gate');
  }, [needsTerms]);

  if (!needsTerms) return children;

  async function onAccept() {
    setBusy(true);
    setError('');
    const token = resolveAcceptTermsToken(window);
    const refreshToken = resolvePrivyRefreshToken(window);
    if (!token && !refreshToken) {
      setError('Session token missing. Sign out and sign in again.');
      setBusy(false);
      return;
    }
    const result = await postAcceptTerms({
      token,
      refreshToken,
      appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
      clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
      caId: readPrivyCaId(window.localStorage),
      storages: [window.localStorage, window.sessionStorage],
    });
    if (!result.ok) {
      setError(result.error === 'token_missing'
        ? 'Session token missing. Sign out and sign in again.'
        : 'Could not accept terms. Try again or sign out.');
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <>
      {children}
      <div className="terms-gate" role="dialog" aria-modal="true" aria-labelledby="terms-gate-title">
        <div className="terms-gate__panel">
          <h1 id="terms-gate-title" className="terms-gate__title">One last step</h1>
          <p className="terms-gate__copy">
            Accept the terms to finish signing in. This confirms your session with Privy.
          </p>
          {error ? <p className="terms-gate__error" role="alert">{error}</p> : null}
          <div className="terms-gate__actions">
            <button type="button" className="terms-gate__accept" disabled={busy} onClick={onAccept}>
              {busy ? 'Accepting…' : 'Accept'}
            </button>
            <button
              type="button"
              className="terms-gate__decline"
              disabled={busy}
              onClick={() => { void onDecline(); }}
            >
              No thanks
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
