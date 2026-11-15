/**
 * Runs once in the browser before React hydrates so Privy token capture is
 * armed before login writes storage or ofetch binds fetch.
 */
import { installAcceptTermsAuth } from './lib/accept-terms-auth.mjs';

installAcceptTermsAuth(window);
