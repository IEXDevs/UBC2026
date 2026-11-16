'use client';

import { useEffect, useState } from 'react';
import Topography from './Topography';
import SpecularButton from './SpecularButton';
import { hasSeenLogin } from '../lib/seen-login.mjs';
import './SignInPage.css';

export default function SignInPage({ disabled = false, onLogin, onDeveloperPreview = null }) {
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    setReturning(hasSeenLogin(window.localStorage));
  }, []);

  const primary = returning ? 'Log in' : 'Sign up';
  const secondary = returning ? 'Sign up' : 'Log in';

  return (
    <div className="sign-in">
      <div className="sign-in-field" aria-hidden="true">
        <Topography
          color="#ff8fa3"
          elevation={1.6}
          scale={0.9}
          tilt={15}
          fog={0.5}
          clickEffect="peak"
          lineCount={30}
          brightness={1.55}
          mouseStrength={0.2}
        />
      </div>
      <main className="sign-in-stage">
        <div className="sign-in-copy">
          <h1 className="sign-in-mark">Maelstrom</h1>
          <p className="sign-in-slogan">Your agent. Your call.</p>
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
          {onDeveloperPreview ? (
            <button type="button" className="sign-in-dev" onClick={onDeveloperPreview}>
              Developer preview
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
