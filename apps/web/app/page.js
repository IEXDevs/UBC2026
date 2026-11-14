'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plug, Plus, Search, Wallet } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import LiveViewPanel from '../components/LiveViewPanel';
import MoneyPane from '../components/MoneyPane';
import ConnectorsPane from '../components/ConnectorsPane';
import BotRail from '../components/BotRail';
import BotPage from '../components/BotPage';
import OverviewPanel from '../components/OverviewPanel';
import SecurityPanel from '../components/SecurityPanel';
import ShoppingPanel from '../components/ShoppingPanel';
import PaneDock from '../components/PaneDock';
import ChatBubbles from '../components/ChatBubbles';
import Composer from '../components/Composer';
import CreateBotDialog from '../components/CreateBotDialog';
import ProfileSheet from '../components/ProfileSheet';
import WalletsSheet from '../components/WalletsSheet';
import { getDemoShellState } from '../lib/demo-state.mjs';
import { moneyPane, walletGlance } from '../lib/money-views.mjs';
import { applyLooks } from '../lib/bot-look.mjs';
import { mergeRoster, reorderIds } from '../lib/roster.mjs';
import { ownerIdFromPrivyUser, privyAccountLabel, privyProviderProps } from '../lib/privy-config.mjs';
import { withAssignedWallet } from '../lib/wallet-assign.mjs';
import { walletProvisionNote, walletsFromPrivyUser } from '../lib/wallet-provision.mjs';

const base = getDemoShellState();
const LOOK_KEY = 'maelstrom.botLooks';
const ROSTER_KEY = 'maelstrom.roster';
const privyConfigured = privyProviderProps({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
}) !== null;

export default function HomePage() {
  if (!privyConfigured) {
    return (
      <Shell
        ownerId={null}
        accountLabel="You"
        signedIn={false}
        loginDisabled
      />
    );
  }
  return <AuthedShell />;
}

function AuthedShell() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const signedIn = ready && authenticated;
  const [liveWallets, setLiveWallets] = useState(null);
  const [walletNote, setWalletNote] = useState('');

  useEffect(() => {
    if (!signedIn) {
      setLiveWallets(null);
      setWalletNote('');
      return undefined;
    }
    let stopped = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token || stopped) return;
        const response = await fetch('/api/wallets', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => ({}));
        if (stopped) return;
        const ok = response.ok && Array.isArray(body.wallets) && body.wallets.length > 0;
        if (!ok) {
          const ownerId = ownerIdFromPrivyUser(user, true);
          const fallback = walletsFromPrivyUser(user, ownerId);
          if (fallback.length > 0) {
            setLiveWallets(fallback);
            setWalletNote(`${walletProvisionNote(body, { ok: false })} Showing the Privy client wallet until server create succeeds.`);
            return;
          }
          setWalletNote(walletProvisionNote(body, { ok: false }));
          return;
        }
        setLiveWallets(body.wallets);
        setWalletNote(walletProvisionNote(body, { ok: true }));
      } catch {
        if (!stopped) {
          const ownerId = ownerIdFromPrivyUser(user, true);
          const fallback = walletsFromPrivyUser(user, ownerId);
          if (fallback.length > 0) {
            setLiveWallets(fallback);
            setWalletNote(`${walletProvisionNote({}, { ok: false })} Showing the Privy client wallet until server create succeeds.`);
          } else {
            setWalletNote(walletProvisionNote({}, { ok: false }));
          }
        }
      }
    })();
    return () => { stopped = true; };
  }, [signedIn, user?.id, getAccessToken]);

  return (
    <Shell
      ownerId={ownerIdFromPrivyUser(user, signedIn)}
      accountLabel={signedIn ? privyAccountLabel(user) : 'You'}
      signedIn={signedIn}
      loginDisabled={!ready}
      onLogin={login}
      onLogout={logout}
      liveWallets={liveWallets}
      walletNote={walletNote}
    />
  );
}

function Shell({ ownerId, accountLabel, signedIn, loginDisabled, onLogin, onLogout, liveWallets = null, walletNote = '' }) {
  const [looks, setLooks] = useState({});
  const [roster, setRoster] = useState({ order: base.bots.map(bot => bot.id), extra: [] });
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [activeBot, setActiveBot] = useState(base.bots[0].id);
  const [pane, setPane] = useState('Main');
  const [slide, setSlide] = useState('right');
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [talks, setTalks] = useState({});
  const [botRecords, setBotRecords] = useState(base.bots);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const closeWallets = useCallback(() => setWalletsOpen(false), []);
  const appendTalk = useCallback((botId, line) => {
    setTalks(current => ({
      ...current,
      [botId]: [...(current[botId] ?? []), line].slice(-80),
    }));
  }, []);
  const dockPanes = useMemo(
    () => [...base.panes.filter((name) => name !== 'Plugins'), 'Overview', 'Security'],
    [],
  );

  useEffect(() => {
    let savedLooks = {};
    let savedRoster = null;
    try {
      const rawLooks = localStorage.getItem(LOOK_KEY);
      if (rawLooks) savedLooks = JSON.parse(rawLooks);
    } catch {
      savedLooks = {};
    }
    try {
      const rawRoster = localStorage.getItem(ROSTER_KEY);
      if (rawRoster) savedRoster = JSON.parse(rawRoster);
    } catch {
      savedRoster = null;
    }
    const merged = mergeRoster(base.bots, savedRoster);
    setLooks(savedLooks);
    setRoster({ order: merged.order, extra: merged.extra });
    setActiveBot(merged.order[0] ?? null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(LOOK_KEY, JSON.stringify(looks));
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  }, [looks, roster, ready]);

  const seedBots = useMemo(() => {
    const byId = new Map(botRecords.map((bot) => [bot.id, bot]));
    return base.bots.map((bot) => ({ ...bot, ...(byId.get(bot.id) || {}) }));
  }, [botRecords]);
  const merged = useMemo(() => mergeRoster(seedBots, roster), [roster, seedBots]);
  const styled = useMemo(() => applyLooks(merged.bots, looks), [merged, looks]);
  const assigned = useMemo(() => withAssignedWallet(styled, liveWallets), [styled, liveWallets]);
  const bots = assigned.bots;
  const wallets = assigned.wallets ?? base.wallets;
  const visible = bots.filter(bot => bot.name.toLowerCase().includes(query.trim().toLowerCase()));
  const bot = bots.find(item => item.id === activeBot) ?? null;
  const money = moneyPane(pane);
  const glance = walletGlance(wallets, base.positions);

  function choosePane(next, direction) {
    if (next === pane) return;
    setSlide(direction);
    setPane(next);
    if (next === 'Main') setActiveBot(current => current ?? bots[0]?.id ?? null);
  }

  function openChat(id) {
    setCreateOpen(false);
    setWalletsOpen(false);
    setProfileOpen(false);
    setActiveBot(id);
    if (pane !== 'Main') {
      setSlide('left');
      setPane('Main');
    }
  }

  function onCreate(created) {
    setRoster(current => ({
      order: [created.id, ...current.order.filter(id => id !== created.id)],
      extra: [created, ...current.extra.filter(item => item.id !== created.id)],
    }));
    setLooks(current => ({
      ...current,
      [created.id]: { name: created.name, shape: created.shape, color: created.color },
    }));
    setActiveBot(created.id);
    setQuery('');
    setSlide('right');
    setPane('Main');
    setCreateOpen(false);
  }

  function onReorder(fromId, toId) {
    setRoster(current => ({ ...current, order: reorderIds(current.order, fromId, toId) }));
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-tools">
          <label className="search">
            <Search size={16} strokeWidth={1.75} />
            <input
              value={query}
              placeholder="Search agents"
              aria-label="Search agents"
              onChange={event => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className="add-agent" onClick={() => { setProfileOpen(false); setCreateOpen(true); }}>
            <Plus size={16} strokeWidth={1.75} />
            Add agent
          </button>
        </div>
        <BotRail
          bots={visible}
          activeId={bot?.id}
          canDrag={!query.trim()}
          onSelect={openChat}
          onReorder={onReorder}
          onCreate={() => setCreateOpen(true)}
        />
        <footer className="you">
          <div className="you-actions">
            <button
              type="button"
              className="you-link"
              onClick={() => { setWalletsOpen(false); setProfileOpen(false); choosePane('Plugins', 'right'); }}
            >
              <Plug size={15} strokeWidth={1.75} />
              Plugins
            </button>
            <button
              type="button"
              className="you-link"
              onClick={() => { setCreateOpen(false); setProfileOpen(false); setWalletsOpen(true); }}
            >
              <Wallet size={15} strokeWidth={1.75} />
              Wallets
            </button>
          </div>
          <button type="button" className="you-btn" onClick={() => { setCreateOpen(false); setWalletsOpen(false); setProfileOpen(true); }}>
            <span className="you-mark" aria-hidden="true">{accountLabel.slice(0, 1)}</span>
            <span className="you-copy">
              <strong>{accountLabel}</strong>
              <small>Account</small>
            </span>
          </button>
        </footer>
      </aside>

      <section className="stage">
        <header className="topbar">
          <span className="topbar-side" />
          <PaneDock panes={dockPanes} pane={pane} onChange={choosePane} />
          <button
            type="button"
            className="wallet-chip"
            onClick={() => { setCreateOpen(false); setProfileOpen(false); setWalletsOpen(true); }}
          >
            <Wallet size={16} strokeWidth={1.75} />
            <span>{glance.balanceLabel}</span>
          </button>
        </header>
        <div key={`${pane}-${slide}`} className={`thread slide-${slide}${pane === 'Positions' ? ' is-book' : ''}`}>
          <article className={`bubble${pane === 'Positions' ? ' is-book' : ''}`} aria-label={pane}>
            {pane === 'Main' ? (
              bot ? (
                <>
                  <header className="bubble-head">
                    <strong>{bot.name}</strong>
                    <span>{bot.type} · {bot.status}</span>
                  </header>
                  <h1>{bot.goal}</h1>
                  <LiveViewPanel botId={bot.id} ownerId={ownerId} />
                  {bot.experience ? <BotPage bot={bot} ownerId={ownerId} /> : null}
                  {bot.type === 'shopping' ? <ShoppingPanel bot={bot} ownerId={ownerId} /> : null}
                  <ChatBubbles botName={bot.name} lines={talks[bot.id] ?? []} />
                </>
              ) : (
                <>
                  <h1>Make your first Agent!</h1>
                  <p>The list stays empty until you create one.</p>
                  <button type="button" className="solid" onClick={() => setCreateOpen(true)}>Create</button>
                </>
              )
            ) : null}
            {money ? <MoneyPane pane={money} state={{ ...base, bots, wallets }} /> : null}
            {pane === 'Plugins' ? <ConnectorsPane connectors={base.connectors} bots={bots} /> : null}
            {pane === 'Overview' ? <OverviewPanel bots={bots} ownerId={ownerId} /> : null}
            {pane === 'Security' ? (
              <SecurityPanel
                bots={bots}
                ownerId={ownerId}
                accountLabel={accountLabel}
                onBotsChange={(next) => setBotRecords(next)}
              />
            ) : null}
          </article>
        </div>
        {bot ? (
          <Composer
            key={bot.id}
            hidden={pane !== 'Main'}
            botName={bot.name}
            lines={talks[bot.id] ?? []}
            onLine={line => appendTalk(bot.id, line)}
          />
        ) : pane === 'Positions' ? null : <div className="composer-gap" />}
      </section>
      <CreateBotDialog open={createOpen} onClose={closeCreate} onCreate={onCreate} />
      <WalletsSheet open={walletsOpen} onClose={closeWallets} state={{ ...base, bots, wallets }} note={walletNote} />
      <ProfileSheet
        open={profileOpen}
        onClose={closeProfile}
        accountLabel={accountLabel}
        glance={glance}
        wallets={wallets}
        signedIn={signedIn}
        loginDisabled={loginDisabled}
        onLogin={onLogin}
        onLogout={onLogout}
      />
    </div>
  );
}
