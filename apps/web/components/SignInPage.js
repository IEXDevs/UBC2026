'use client';

import Topography from './Topography';
import SpecularButton from './SpecularButton';
import EmailSignIn from './EmailSignIn';
import { usePrivyPublic } from './PrivyRoot';
import './SignInPage.css';

export default function SignInPage({
  disabled = false,
  onLogin,
  onDeveloperPreview = null,
  onHoldChange = null,
}) {
  const { configured } = usePrivyPublic();

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
          <div className="sign-in-card">
            {configured ? <EmailSignIn disabled={disabled} onHoldChange={onHoldChange} /> : null}
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
                {configured ? 'More ways to continue' : 'Continue'}
              </SpecularButton>
            </div>
            {onDeveloperPreview ? (
              <button type="button" className="sign-in-dev" onClick={onDeveloperPreview}>
                Developer preview
              </button>
            ) : null}
            <p className="sign-in-legal">
              <a href="/privacy">Privacy</a>
              <a href="/tos">Terms</a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
