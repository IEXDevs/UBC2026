'use client';

import { useEffect, useState } from 'react';
import Antigravity from './Antigravity';
import SpecularButton from './SpecularButton';
import { hasSeenLogin } from '../lib/seen-login.mjs';
import './SignInPage.css';

export default function SignInPage({ disabled = false, onLogin }) {
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    setReturning(hasSeenLogin(window.localStorage));
  }, []);

  const primary = returning ? 'Log in' : 'Sign up';
  const secondary = returning ? 'Sign up' : 'Log in';

  return (
    <div className="sign-in">
      <div className="sign-in-field" aria-hidden="true">
        <Antigravity />
      </div>
      <main className="sign-in-stage">
        <div className="sign-in-copy">
          <h1>Make your first agent.</h1>
          <div className="sign-in-actions">
            <SpecularButton
              size="lg"
              radius={999}
              tint="#f4f1fb"
              tintOpacity={0.94}
              textColor="#120f17"
              disabled={disabled || !onLogin}
              onClick={onLogin}
            >
              {primary}
            </SpecularButton>
            <button
              type="button"
              className="sign-in-alt"
              disabled={disabled || !onLogin}
              onClick={onLogin}
            >
              {secondary}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
