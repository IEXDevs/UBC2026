import { Wallet } from 'lucide-react';
import AddressCopy from './AddressCopy';
import AddressText from './AddressText';
import BotMark from './BotMark';
import PositionWalletBubbles from './PositionWalletBubbles';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

export function usdLabel(notionalLabel) {
  if (!notionalLabel) return '';
  const amount = notionalLabel.replace(/ USDC$/, '');
  return amount.startsWith('-') ? `-$${amount.slice(1)}` : `$${amount}`;
}

function VenueLogo({ src }) {
  return src ? <img className="book-logo" alt="" draggable={false} src={src} /> : null;
}

export function WalletCard({ wallet, sprites }) {
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
          <PositionWalletBubbles wallet={wallet} sprites={sprites} />
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
      <BotMark name={agent.name} color={agent.color} image={agent.image} size={22} />
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
