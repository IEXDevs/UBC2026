'use client';

import { useEffect, useRef, useState } from 'react';
import { useLoginWithEmail } from '@privy-io/react-auth';
import CodeSlots from './CodeSlots';
import {
  classifyEmailOtpError,
  emailOtpStatusMessage,
  isCompleteOtp,
  nextCodeGeneration,
  normalizeOtpCode,
  OTP_LENGTH,
} from '../lib/email-otp.mjs';

function looksLikeEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function EmailSignIn({ disabled = false }) {
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('email');
  const [code, setCode] = useState('');
  const [slotStatus, setSlotStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeGeneration, setCodeGeneration] = useState(0);
  const attemptGeneration = useRef(0);
  const verifying = useRef(false);

  useEffect(() => {
    if (state?.status === 'error' && state?.error) {
      const classified = classifyEmailOtpError(state.error, {
        codeGeneration,
        attemptGeneration: attemptGeneration.current,
      });
      setSlotStatus('error');
      setMessage(classified.message);
    }
  }, [state, codeGeneration]);

  async function onSend(event) {
    event?.preventDefault?.();
    if (disabled || busy) return;
    const nextEmail = email.trim();
    if (!looksLikeEmail(nextEmail)) {
      setMessage('Enter a valid email address to receive a code.');
      return;
    }
    setBusy(true);
    setMessage(emailOtpStatusMessage('sending'));
    setSlotStatus('idle');
    setCode('');
    try {
      await sendCode({ email: nextEmail });
      const generation = nextCodeGeneration(codeGeneration);
      setCodeGeneration(generation);
      attemptGeneration.current = generation;
      setStep('code');
      setMessage(emailOtpStatusMessage('sent'));
    } catch (error) {
      const classified = classifyEmailOtpError(error);
      setMessage(classified.message);
      setSlotStatus('error');
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    if (disabled || busy || !looksLikeEmail(email)) return;
    setBusy(true);
    setSlotStatus('idle');
    setCode('');
    setMessage(emailOtpStatusMessage('sending'));
    try {
      await sendCode({ email: email.trim() });
      const generation = nextCodeGeneration(codeGeneration);
      setCodeGeneration(generation);
      attemptGeneration.current = generation;
      setMessage('A new code is on the way. Earlier codes will no longer work.');
    } catch (error) {
      const classified = classifyEmailOtpError(error);
      setMessage(classified.message);
      setSlotStatus('error');
    } finally {
      setBusy(false);
    }
  }

  async function verify(raw) {
    const next = normalizeOtpCode(raw);
    if (!isCompleteOtp(next) || verifying.current || busy || disabled) return;
    verifying.current = true;
    setBusy(true);
    setSlotStatus('idle');
    setMessage(emailOtpStatusMessage('verifying'));
    try {
      await loginWithCode({ code: next });
      setSlotStatus('success');
      setMessage(emailOtpStatusMessage('success'));
    } catch (error) {
      const classified = classifyEmailOtpError(error, {
        codeGeneration,
        attemptGeneration: attemptGeneration.current,
      });
      setSlotStatus('error');
      setMessage(classified.message);
      setCode('');
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  }

  if (step === 'code') {
    return (
      <div className="sign-in-email">
        <p className="sign-in-email-label">Code sent to {email.trim()}</p>
        <CodeSlots
          length={OTP_LENGTH}
          value={code}
          status={slotStatus}
          message={message}
          disabled={disabled || busy || slotStatus === 'success'}
          autoFocus
          onChange={(next) => {
            attemptGeneration.current = codeGeneration;
            setCode(next);
            if (slotStatus === 'error') {
              setSlotStatus('idle');
              setMessage(emailOtpStatusMessage('sent'));
            }
          }}
          onComplete={verify}
        />
        <div className="sign-in-email-actions">
          <button type="button" className="sign-in-email-link" disabled={disabled || busy} onClick={onResend}>
            Resend code
          </button>
          <button
            type="button"
            className="sign-in-email-link"
            disabled={disabled || busy}
            onClick={() => {
              setStep('email');
              setCode('');
              setSlotStatus('idle');
              setMessage('');
            }}
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="sign-in-email" onSubmit={onSend}>
      <label className="sign-in-email-field">
        <span className="sign-in-email-label">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@school.edu"
          value={email}
          disabled={disabled || busy}
          onChange={(event) => {
            setEmail(event.target.value);
            if (message) setMessage('');
          }}
        />
      </label>
      {message ? <p className="sign-in-email-message" role="status">{message}</p> : null}
      <button type="submit" className="sign-in-email-submit" disabled={disabled || busy || !looksLikeEmail(email)}>
        Send code
      </button>
    </form>
  );
}
