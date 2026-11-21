import { useId } from 'react';
import { Wallet } from 'lucide-react';
import AddressCopy from './AddressCopy';
import AddressText from './AddressText';
import BotMark from './BotMark';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

const BUBBLE_PALETTE = [
  ['#62d9ff', '#1775e6', '#16317a'],
  ['#d497ff', '#9246e8', '#442182'],
  ['#64efd0', '#17a782', '#09534e'],
  ['#ffca69', '#ed7a25', '#8a3715'],
  ['#ff98c1', '#dc427f', '#801c4a'],
  ['#bdeb6a', '#66ab2e', '#34591b'],
  ['#80baff', '#4b58e4', '#252779'],
  ['#ff9d94', '#e74f51', '#812a2f'],
];

export function usdLabel(notionalLabel) {
  if (!notionalLabel) return '';
  const amount = notionalLabel.replace(/ USDC$/, '');
  return amount.startsWith('-') ? `-$${amount.slice(1)}` : `$${amount}`;
}

function VenueLogo({ src }) {
  return src ? <img className="book-logo" alt="" draggable={false} src={src} /> : null;
}

export function WalletCard({ wallet }) {
  const gradientId = useId();
  return (
    <Card className="book-wallet-surface size-full gap-0 p-0">
      <CardHeader className="book-wallet-head p-0">
        <CardTitle className="book-wallet-name">
          <Wallet size={14} strokeWidth={1.75} aria-hidden="true" />
          <span title={wallet.label}>{wallet.label}</span>
        </CardTitle>
        <b>{wallet.holdingsLabel}</b>
      </CardHeader>
      <CardDescription>
        <AddressCopy address={wallet.fullAddress} inline />
        {wallet.frozen ? ' · Frozen' : wallet.readOnly ? ' · Read-only' : ''}
      </CardDescription>
      {wallet.bubbles.length > 0 && (
        <CardContent className="p-0">
          <svg
            className="book-wallet-bubbles"
            viewBox={`0 0 ${wallet.bubbleWidth} ${wallet.bubbleHeight}`}
            role="group"
            aria-label={wallet.bubbles.map(bubble => `${bubble.asset} ${bubble.valueLabel}`).join(', ')}
          >
            <defs>
              <radialGradient id={`${gradientId}-reflection`}>
                <stop stopColor="#f0f8ff" stopOpacity="0.62" />
                <stop offset="100%" stopColor="#f0f8ff" stopOpacity="0" />
              </radialGradient>
              {BUBBLE_PALETTE.map(([highlight, mid, shadow], index) => (
                <radialGradient key={highlight} id={`${gradientId}-${index}`} cx="32%" cy="22%" r="78%">
                  <stop stopColor={highlight} />
                  <stop offset="62%" stopColor={mid} />
                  <stop offset="100%" stopColor={shadow} />
                </radialGradient>
              ))}
            </defs>
            {wallet.bubbles.map((bubble, index) => {
              const label = [bubble.asset, bubble.valueLabel, bubble.amountLabel].filter(Boolean).join(' · ');
              return (
                <g key={bubble.id}>
                  <circle
                    className="book-wallet-bubble"
                    tabIndex={0}
                    role="img"
                    aria-label={label}
                    cx={bubble.x} cy={bubble.y} r={bubble.r}
                    fill={`url(#${gradientId}-${index % BUBBLE_PALETTE.length})`}
                    strokeWidth={Math.min(0.9, bubble.r / 5)}
                  >
                    <title>{label}</title>
                  </circle>
                  <ellipse
                    className="book-wallet-reflection"
                    cx={bubble.x - bubble.r * 0.28} cy={bubble.y - bubble.r * 0.56}
                    rx={bubble.r * 0.56} ry={bubble.r * 0.19}
                    transform={`rotate(-27 ${bubble.x - bubble.r * 0.28} ${bubble.y - bubble.r * 0.56})`}
                    fill={`url(#${gradientId}-reflection)`}
                  />
                  {bubble.r * 2 >= bubble.asset.length * 5 + 7 && <text x={bubble.x} y={bubble.y}>{bubble.asset}</text>}
                </g>
              );
            })}
          </svg>
        </CardContent>
      )}
      {wallet.unpriced > 0 && <CardDescription>{wallet.unpriced} unpriced</CardDescription>}
    </Card>
  );
}

export function ProviderGroupCard({ account }) {
  return (
    <Card className="book-account-surface flex-row items-center gap-2 p-0">
      <VenueLogo src={account.logo} />
      <CardHeader className="book-glance-copy gap-0 p-0">
        <CardTitle>{account.venue}</CardTitle>
        <CardDescription>{account.count} {account.count === 1 ? 'position' : 'positions'}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function AgentCard({ agent }) {
  return (
    <Card className="book-agent-surface" aria-label={`Agent ${agent.name}`}>
      <BotMark name={agent.name} color={agent.color} image={agent.image} size={24} />
      <CardTitle title={agent.name}>{agent.name}</CardTitle>
    </Card>
  );
}

function PositionFace({ className, children }) {
  return (
    <Card className={`book-face block ${className}`}>
      <span className="book-spot" />
      <span className="book-glare" />
      {children}
    </Card>
  );
}

export function ProviderPositionCard({ card }) {
  const addresses = card.mint ? [card.mint] : [];
  const metrics = [
    ['Entry', card.entry], ['Mark', card.mark], ['Leverage', card.leverage], ['Health', card.healthLabel],
    ['APY', card.apyLabel], ['PnL', usdLabel(card.pnlLabel), card.pnlDown ? 'book-pnl is-down' : 'book-pnl is-up'],
  ];
  return (
    <div className="book-tilt">
      <div className="book-flip">
        <PositionFace className="book-front">
          <CardHeader className="book-glance p-0">
            <VenueLogo src={card.logo} />
            <div>
              <CardTitle><strong><AddressText text={card.asset} addresses={addresses} /></strong></CardTitle>
              <CardDescription className="book-position-source">{[card.venue, card.side].filter(Boolean).join(' · ')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <p className="book-size"><AddressText text={card.amountLabel} addresses={addresses} /></p>
            <p className="book-usd">{usdLabel(card.notionalLabel)}</p>
          </CardContent>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="book-spark" style={{ '--sx': `${18 + ((index * 37) % 70)}%`, '--sy': `${18 + ((index * 23) % 68)}%` }} />
          ))}
        </PositionFace>
        <PositionFace className="book-back">
          <CardHeader className="book-card-top p-0">
            <CardTitle><strong><AddressText text={card.market} addresses={addresses} /></strong></CardTitle>
            {card.venue && <CardDescription className="book-side">{card.venue}</CardDescription>}
          </CardHeader>
          <CardContent className="p-0">
            {metrics.filter(([, value]) => value).map(([label, value, className]) => (
              <div key={label} className={className ? `book-metric ${className}` : 'book-metric'}>
                <span>{label}</span><b>{value}</b>
              </div>
            ))}
            <small>{card.botName}</small>
          </CardContent>
        </PositionFace>
      </div>
      <span className="book-glow" />
    </div>
  );
}
