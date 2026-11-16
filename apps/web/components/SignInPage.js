'use client';

import Topography from './Topography';
import SpecularButton from './SpecularButton';
import './SignInPage.css';

export default function SignInPage({ disabled = false, onLogin, onDeveloperPreview = null }) {
  return (
    <div className="sign-in">
      <div className="sign-in-field" aria-hidden="true">
        <Topography
          color="#ff7a62"
          tilt={27}
          foreground={1}
          lineCount={20}
          lineWidth={1.5}
          depthOfField={0}
          trail={1}
          detail={1}
          morph={1}
          fog={0}
        />
      </div>
      <main className="sign-in-stage">
        <div className="sign-in-copy">
          <h1 className="sign-in-mark">Maelstrom</h1>
          <p className="sign-in-slogan">Your agent. Your call.</p>
          <div className="sign-in-actions">
            <SpecularButton
              size="lg"
              radius={20}
              tint="#f4f1fb"
              tintOpacity={0.94}
              textColor="#120f17"
              disabled={disabled || !onLogin}
              onClick={onLogin}
            >
              Continue
            </SpecularButton>
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
