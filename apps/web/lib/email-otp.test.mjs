import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  classifyEmailOtpError,
  emailOtpStatusMessage,
  isCompleteOtp,
  nextCodeGeneration,
  normalizeOtpCode,
} from './email-otp.mjs';

const root = dirname(fileURLToPath(import.meta.url));

test('six-digit paste and typing normalize to a complete OTP', () => {
  assert.equal(normalizeOtpCode('12-34 56'), '123456');
  assert.equal(normalizeOtpCode('123456789'), '123456');
  assert.equal(isCompleteOtp('123456'), true);
  assert.equal(isCompleteOtp('12345'), false);
});

test('resend then old code is superseded; newest code is allowed', () => {
  const afterFirst = nextCodeGeneration(0);
  assert.equal(afterFirst, 1);
  const afterResend = nextCodeGeneration(afterFirst);
  assert.equal(afterResend, 2);

  const oldAttempt = classifyEmailOtpError(
    { error: 'invalid_credentials', message: 'Invalid code' },
    { codeGeneration: afterResend, attemptGeneration: afterFirst },
  );
  assert.equal(oldAttempt.kind, 'superseded');
  assert.match(oldAttempt.message, /replaced|newest|resend/i);

  const newAttempt = classifyEmailOtpError(
    null,
    { codeGeneration: afterResend, attemptGeneration: afterResend },
  );
  // No error object means caller only uses this helper on failure; invalid fallback is fine
  // but generation match must not force superseded.
  assert.notEqual(newAttempt.kind, 'superseded');

  const invalidNew = classifyEmailOtpError(
    { error: 'invalid_credentials' },
    { codeGeneration: afterResend, attemptGeneration: afterResend },
  );
  assert.equal(invalidNew.kind, 'invalid');
  assert.match(invalidNew.message, /did not match|newest|resend/i);
});

test('expired and temporary failures stay actionable without restarting sign-in', () => {
  const expired = classifyEmailOtpError({ message: 'OTP expired' });
  assert.equal(expired.kind, 'expired');
  assert.match(expired.message, /expired|resend/i);

  const temporary = classifyEmailOtpError({ error: 'too_many_requests' });
  assert.equal(temporary.kind, 'temporary');
  assert.match(temporary.message, /wait|resend/i);

  assert.match(emailOtpStatusMessage('error', expired.message), /expired/i);
  assert.match(emailOtpStatusMessage('sent'), /6-digit/i);
});

test('sign-in wires CodeSlots one-time-code semantics for email OTP', () => {
  const signIn = readFileSync(join(root, '../components/SignInPage.js'), 'utf8');
  const emailSignIn = readFileSync(join(root, '../components/EmailSignIn.js'), 'utf8');
  const slots = readFileSync(join(root, '../components/CodeSlots.jsx'), 'utf8');
  assert.match(signIn, /EmailSignIn/);
  assert.match(emailSignIn, /useLoginWithEmail/);
  assert.match(emailSignIn, /CodeSlots/);
  assert.match(emailSignIn, /onResend/);
  assert.match(slots, /autoComplete="one-time-code"/);
  assert.match(slots, /name="one-time-code"/);
  assert.match(slots, /code-slots__message/);
});

test('sign-in drops the slogan, uses a blur card, and holds the accepted state', () => {
  const signIn = readFileSync(join(root, '../components/SignInPage.js'), 'utf8');
  const css = readFileSync(join(root, '../components/SignInPage.css'), 'utf8');
  const emailSignIn = readFileSync(join(root, '../components/EmailSignIn.js'), 'utf8');
  assert.doesNotMatch(signIn, /Your agent\. Your call\./);
  assert.match(signIn, /sign-in-card/);
  assert.match(css, /\.sign-in-card \{[\s\S]*background: transparent;/);
  assert.match(signIn, /<h1 className="sign-in-mark">Maelstrom<\/h1>/);
  assert.doesNotMatch(signIn, /WarpWordmark|TechWordmark/);
  assert.match(signIn, /no-copy/);
  assert.match(signIn, /onCopy=\{blockCopy\}/);
  assert.match(css, /\.sign-in-card::before \{[\s\S]*background: rgba\(8, 8, 10, 0\.94\);[\s\S]*backdrop-filter: blur/);
  assert.match(emailSignIn, /EMAIL_ACCEPTED_HOLD_MS/);
  assert.match(emailSignIn, /aria-label="Dismiss"/);
});
