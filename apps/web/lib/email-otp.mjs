/**
 * Email one-time-code helpers for the custom Privy email login path.
 * Tracks which code generation is live so a resend can mark older codes superseded.
 */

export const OTP_LENGTH = 6;

export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizeOtpCode(value, length = OTP_LENGTH) {
  return digitsOnly(value).slice(0, length);
}

export function isCompleteOtp(value, length = OTP_LENGTH) {
  return normalizeOtpCode(value, length).length === length;
}

export function nextCodeGeneration(current = 0) {
  const n = Number(current);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) + 1 : 1;
}

/**
 * Map Privy / network failures and local generation mismatch to actionable copy.
 */
export function classifyEmailOtpError(error, { codeGeneration = 0, attemptGeneration = 0 } = {}) {
  if (Number(attemptGeneration) > 0 && Number(attemptGeneration) < Number(codeGeneration)) {
    return {
      kind: 'superseded',
      message: 'That code was replaced. Enter the newest code from your email, or resend another.',
    };
  }

  const code = String(error?.error || error?.code || error?.type || '').toLowerCase();
  const text = String(error?.message || '').toLowerCase();
  const blob = `${code} ${text}`;

  if (/too_many|rate|429|temporarily/.test(blob)) {
    return {
      kind: 'temporary',
      message: 'Too many tries right now. Wait a moment, then resend a new code.',
    };
  }
  if (/expired|timeout|gone/.test(blob)) {
    return {
      kind: 'expired',
      message: 'That code expired. Resend a new code and try again.',
    };
  }
  if (/max.?attempt|no longer valid|used/.test(blob)) {
    return {
      kind: 'superseded',
      message: 'That code is no longer valid. Resend a new code and enter it here.',
    };
  }
  if (/invalid_credentials|invalid.?code|incorrect|wrong|mismatch/.test(blob)) {
    return {
      kind: 'invalid',
      message: 'That code did not match. Check the latest email, or resend a new code.',
    };
  }
  if (/network|fetch|failed to fetch|offline/.test(blob)) {
    return {
      kind: 'temporary',
      message: 'Could not verify that code. Check your connection and try again.',
    };
  }
  return {
    kind: 'invalid',
    message: 'That code could not be verified. Enter the newest code, or resend.',
  };
}

export function emailOtpStatusMessage(status, detail = '') {
  if (status === 'success') return 'Code accepted. Signing you in.';
  if (status === 'sending') return 'Sending a code to your email.';
  if (status === 'verifying') return 'Checking your code.';
  if (status === 'sent') return 'Enter the 6-digit code from your email.';
  if (status === 'error') return detail || 'That code could not be verified.';
  return detail || '';
}
