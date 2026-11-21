'use client';

export function SolanaLogo({ size = 36, className = '' }) {
  return (
    <div
      className={`solana-logo-wrap ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#0a0a0a',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
      }}
    >
      <svg width={size * 0.65} height={size * 0.55} viewBox="0 0 397 311" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h313.7c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sol-grad-1)"/>
        <path d="M64.6 3.8C67 1.4 70.3 0 73.8 0h313.7c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#sol-grad-2)"/>
        <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H10.2c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h313.7c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#sol-grad-3)"/>
        <defs>
          <linearGradient id="sol-grad-1" x1="363.9" y1="311" x2="160.5" y2="-92.4" gradientUnits="userSpaceOnUse">
            <stop stopColor="#00FFA3"/>
            <stop offset="1" stopColor="#DC1FFF"/>
          </linearGradient>
          <linearGradient id="sol-grad-2" x1="363.9" y1="311" x2="160.5" y2="-92.4" gradientUnits="userSpaceOnUse">
            <stop stopColor="#00FFA3"/>
            <stop offset="1" stopColor="#DC1FFF"/>
          </linearGradient>
          <linearGradient id="sol-grad-3" x1="363.9" y1="311" x2="160.5" y2="-92.4" gradientUnits="userSpaceOnUse">
            <stop stopColor="#00FFA3"/>
            <stop offset="1" stopColor="#DC1FFF"/>
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export function UsdcLogo({ size = 36, className = '' }) {
  return (
    <div
      className={`usdc-logo-wrap ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#2775CA',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.12)',
      }}
    >
      <svg width={size * 0.65} height={size * 0.65} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.8 17.6c0-1.8-1.1-2.4-3.2-2.7-1.5-.2-1.8-.6-1.8-1.3 0-.7.6-1.2 1.7-1.2 1 0 1.6.4 1.9 1 .1.2.3.3.5.3h1c.3 0 .5-.2.4-.5-.4-1.2-1.4-2.1-2.8-2.3V9.4c0-.3-.2-.5-.5-.5h-1.2c-.3 0-.5.2-.5.5v1.4c-1.6.3-2.7 1.4-2.7 2.8 0 1.7 1 2.4 3.2 2.7 1.4.3 1.8.6 1.8 1.4 0 .8-.8 1.4-1.9 1.4-1.4 0-2-.5-2.3-1.3 0-.2-.2-.3-.5-.3h-1.1c-.3 0-.5.2-.5.5.4 1.4 1.6 2.4 3.4 2.6v1.5c0 .3.2.5.5.5h1.2c.3 0 .5-.2.5-.5v-1.5c1.6-.2 2.7-1.4 2.7-2.9z" fill="#FFFFFF"/>
        <path d="M16 4C9.4 4 4 9.4 4 16s5.4 12 12 12c1.7 0 3.3-.4 4.8-1-.3-.4-.5-.9-.5-1.5 0-.2 0-.3.1-.5-1.3.6-2.8.9-4.4.9-5.5 0-10-4.5-10-10S10.5 6 16 6c5.5 0 10 4.5 10 10 0 .5 0 1.1-.1 1.6.4.1.8.3 1.1.6.6-.7.9-1.4 1-2.2.0-.3 0-.7 0-1 0-6.6-5.4-12-12-12z" fill="#FFFFFF" fillOpacity="0.45"/>
      </svg>
    </div>
  );
}

export function SolanaBadge({ size = 15, className = '' }) {
  return (
    <span
      className={`solana-badge-overlay ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#000000',
        border: '1.5px solid #141414',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'absolute',
        bottom: -2,
        right: -2,
        boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
      }}
    >
      <svg width={size * 0.65} height={size * 0.55} viewBox="0 0 397 311" fill="none">
        <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h313.7c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="#FFFFFF"/>
        <path d="M64.6 3.8C67 1.4 70.3 0 73.8 0h313.7c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="#FFFFFF"/>
        <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H10.2c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h313.7c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="#FFFFFF"/>
      </svg>
    </span>
  );
}

export function VerifiedBadge({ size = 15, className = '' }) {
  return (
    <span
      className={`verified-badge-wrap ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
      title="Verified token"
    >
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1L9.7 2.6L12 2.7L12.7 4.9L14.7 6.1L14.3 8.4L15.3 10.5L13.5 11.9L13.3 14.2L11 14.5L9.6 16.3L7.5 15.3L5.4 16.2L4.1 14.3L1.8 13.9L1.8 11.6L0.2 10.1L1.3 7.9L0.7 5.7L2.8 4.6L3.6 2.3L5.9 2.5L7.7 1L8 1Z"
          fill="#3b82f6"
        />
        <path
          d="M5.2 8.2L7.1 10.1L10.8 6.4"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function TokenIcon({ symbol = '', mint = '', size = 42, className = '', showSolanaBadge = true }) {
  const norm = (symbol || '').toUpperCase().trim();
  const isSol = norm === 'SOL' || norm === 'WSOL' || norm === 'SOLANA';
  const isUsdc = norm === 'USDC' || norm === 'FUSDC' || norm === 'JIUSDC';

  return (
    <div
      className={`phantom-token-icon ${className}`.trim()}
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {isSol ? (
        <SolanaLogo size={size} />
      ) : isUsdc ? (
        <>
          <UsdcLogo size={size} />
          {showSolanaBadge ? <SolanaBadge size={Math.round(size * 0.42)} /> : null}
        </>
      ) : (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: '#161616',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: Math.round(size * 0.38),
            color: '#e5e7eb',
          }}
        >
          {norm.slice(0, 3) || 'TOK'}
          {showSolanaBadge ? <SolanaBadge size={Math.round(size * 0.42)} /> : null}
        </div>
      )}
    </div>
  );
}
