'use client';

import { useEffect, useRef, useState } from 'react';
import { useLoginWithEmail } from '@privy-io/react-auth';
import CodeSlots from './CodeSlots';
import { EMAIL_ACCEPTED_HOLD_MS } from '../lib/confirm-hold.mjs';
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

function MessageRow({ message, tone = 'error', onDismiss }) {
  if (!message) return null;
  return (
    <p className={`sign-in-email-message${tone === 'ok' ? ' is-ok' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {tone === 'error' && onDismiss ? (
        <button type="button" className="sign-in-email-dismiss" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      ) : null}
    </p>
  );
}

export default function EmailSignIn({ disabled = false, onHoldChange = null }) {
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('email');
  const [code, setCode] = useState('');
  const [slotStatus, setSlotStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('status');
  const [busy, setBusy] = useState(false);
  const [codeGeneration, setCodeGeneration] = useState(0);
  const attemptGeneration = useRef(0);
  const verifying = useRef(false);
  const holdTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  useEffect(() => {
    if (state?.status === 'error' && state?.error) {
      const classified = classifyEmailOtpError(state.error, {
        codeGeneration,
        attemptGeneration: attemptGeneration.current,
      });
      setSlotStatus('error');
      setMessageTone('error');
      setMessage(classified.message);
    }
  }, [state, codeGeneration]);

  function clearError() {
    setMessage('');
    setMessageTone('status');
    if (slotStatus === 'error') setSlotStatus('idle');
  }

  async function onSend(event) {
    event?.preventDefault?.();
    if (disabled || busy) return;
    const nextEmail = email.trim();
    if (!looksLikeEmail(nextEmail)) {
      setMessageTone('error');
      setMessage('Enter a valid email address to receive a code.');
      return;
    }
    setBusy(true);
    setMessageTone('status');
    setMessage(emailOtpStatusMessage('sending'));
    setSlotStatus('idle');
    setCode('');
    try {
      await sendCode({ email: nextEmail });
      const generation = nextCodeGeneration(codeGeneration);
      setCodeGeneration(generation);
      attemptGeneration.current = generation;
      setStep('code');
      setMessageTone('status');
      setMessage(emailOtpStatusMessage('sent'));
    } catch (error) {
      const classified = classifyEmailOtpError(error);
      setMessageTone('error');
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
    setMessageTone('status');
    setMessage(emailOtpStatusMessage('sending'));
    try {
      await sendCode({ email: email.trim() });
      const generation = nextCodeGeneration(codeGeneration);
      setCodeGeneration(generation);
      attemptGeneration.current = generation;
      setMessageTone('status');
      setMessage('A new code is on the way. Earlier codes will no longer work.');
    } catch (error) {
      const classified = classifyEmailOtpError(error);
      setMessageTone('error');
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
    setMessageTone('status');
    setMessage(emailOtpStatusMessage('verifying'));
    onHoldChange?.(true);
    try {
      await loginWithCode({ code: next });
      setSlotStatus('success');
      setMessageTone('ok');
      setMessage(emailOtpStatusMessage('success'));
      holdTimer.current = window.setTimeout(() => onHoldChange?.(false), EMAIL_ACCEPTED_HOLD_MS);
    } catch (error) {
      onHoldChange?.(false);
      const classified = classifyEmailOtpError(error, {
        codeGeneration,
        attemptGeneration: attemptGeneration.current,
      });
      setSlotStatus('error');
      setMessageTone('error');
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
          onDismissError={clearError}
          onChange={(next) => {
            attemptGeneration.current = codeGeneration;
            setCode(next);
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
              setMessageTone('status');
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
          }}
        />
      </label>
      <MessageRow message={message} tone={messageTone === 'error' ? 'error' : messageTone === 'ok' ? 'ok' : 'status'} onDismiss={clearError} />
      <button type="submit" className="sign-in-email-submit" disabled={disabled || busy || !looksLikeEmail(email)}>
        Send code
      </button>
    </form>
  );
}
