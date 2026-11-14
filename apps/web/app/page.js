'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Search, Wallet } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import LiveViewPanel from '../components/LiveViewPanel';
import MoneyPane from '../components/MoneyPane';
import ConnectorsPane from '../components/ConnectorsPane';
import BotRail from '../components/BotRail';
import BotPage from '../components/BotPage';
import SecurityPanel from '../components/SecurityPanel';
import LogsPanel from '../components/LogsPanel';
import AccountMenu from '../components/AccountMenu';
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
import { parseRecipient, privyAvatarUrl } from '@ubc2026/contracts';
import { buildBotStats } from '../lib/overview.mjs';
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
          headers: {
            Authorization: `Bearer ${token}`,
            ...(user?.id ? { 'x-owner-id': user.id } : {}),
          },
        });
        const body = await response.json().catch(() => ({}));
        if (stopped) return;
        const ok = response.ok && Array.isArray(body.wallets) && body.wallets.length > 0;
        if (!ok) {
          console.error('[wallets] provision failed', response.status, {
            error: body.error,
            detail: body.detail,
            missing: body.missing,
          });
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
      user={signedIn ? user : null}
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

function profileKey(ownerId) {
  return ownerId ? `maelstrom.profile.${ownerId}` : '';
}

function Shell({ ownerId, user = null, accountLabel, signedIn, loginDisabled, onLogin, onLogout, liveWallets = null, walletNote = '' }) {
  const [looks, setLooks] = useState({});
  const [roster, setRoster] = useState({ order: base.bots.map(bot => bot.id), extra: [] });
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [activeBot, setActiveBot] = useState(base.bots[0].id);
  const [pane, setPane] = useState('Main');
  const [slide, setSlide] = useState('right');
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [talks, setTalks] = useState({});
  const [thinkingBot, setThinkingBot] = useState(null);
  const [botRecords, setBotRecords] = useState(base.bots);
  const [profile, setProfile] = useState(null);
  const avatarUrl = profile?.avatarUrl || privyAvatarUrl(user);
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
    () => base.panes.filter((name) => name !== 'Plugins'),
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

  useEffect(() => {
    const key = profileKey(ownerId);
    if (!key) {
      setProfile(null);
      return undefined;
    }
    try {
      const raw = localStorage.getItem(key);
      const local = raw ? JSON.parse(raw) : null;
      if (local?.handle && local?.displayName) setProfile(local);
    } catch {
      setProfile(null);
    }
    const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';
    if (!runtimeBase) return undefined;
    let stop = false;
    (async () => {
      try {
        const response = await fetch(`${runtimeBase.replace(/\/$/, '')}/api/profiles/me`, {
          headers: { 'x-owner-id': ownerId },
          cache: 'no-store',
        });
        const body = await response.json();
        if (!stop && body.profile?.handle) {
          setProfile(body.profile);
          localStorage.setItem(key, JSON.stringify(body.profile));
        }
      } catch {
        // Keep the profile stored on this device.
      }
    })();
    return () => { stop = true; };
  }, [ownerId]);

  const saveProfile = useCallback(async (next) => {
    const stored = { ...next, avatarUrl: next.avatarUrl || privyAvatarUrl(user) || null };
    const key = profileKey(ownerId);
    const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';
    if (runtimeBase && ownerId) {
      const response = await fetch(`${runtimeBase.replace(/\/$/, '')}/api/profiles/me`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-owner-id': ownerId },
        body: JSON.stringify(stored),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) return { error: 'handle_taken' };
      if (!response.ok) throw new Error('profile_save_failed');
      setProfile(stored);
      if (key) localStorage.setItem(key, JSON.stringify(stored));
      return body;
    }
    setProfile(stored);
    if (key) localStorage.setItem(key, JSON.stringify(stored));
    return { ok: true, source: 'local' };
  }, [ownerId, user]);

  const resolveMention = useCallback(async (token) => {
    const parsed = parseRecipient(token);
    if (!parsed) return null;
    const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';
    if (runtimeBase && ownerId) {
      try {
        const url = new URL(`${runtimeBase.replace(/\/$/, '')}/api/profiles/lookup`);
        url.searchParams.set('q', token);
        const response = await fetch(url, { headers: { 'x-owner-id': ownerId }, cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (body.recipient) return body.recipient;
        if (parsed.kind === 'sns') return { ...parsed, error: body.error || 'sns_not_found' };
      } catch {
        // Fall through to the profile stored on this device.
      }
    }
    if (parsed.kind === 'handle' && profile?.handle === parsed.handle) {
      return { kind: 'handle', handle: profile.handle, displayName: profile.displayName, self: true };
    }
    if (parsed.kind === 'sns') return parsed;
    return { kind: 'handle', handle: parsed.handle, missing: true };
  }, [ownerId, profile]);

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

  function onAccount(id) {
    setCreateOpen(false);
    if (id === 'profile') {
      setWalletsOpen(false);
      setProfileOpen(true);
      return;
    }
    if (id === 'wallet') {
      setProfileOpen(false);
      setWalletsOpen(true);
      return;
    }
    setProfileOpen(false);
    setWalletsOpen(false);
    if (id === 'plugins') choosePane('Plugins', 'right');
    if (id === 'security') choosePane('Security', 'right');
    if (id === 'logs') choosePane('Logs', 'right');
  }

  return (
    <div className={`shell${railCollapsed ? ' is-collapsed' : ''}`}>
      <aside className={`side${railCollapsed ? ' is-collapsed' : ''}`}>
        <div className="side-tools">
          <button
            type="button"
            className="icon-btn rail-toggle"
            aria-pressed={railCollapsed}
            aria-label={railCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            onClick={() => setRailCollapsed(current => !current)}
          >
            {railCollapsed
              ? <PanelLeftOpen size={16} strokeWidth={1.75} />
              : <PanelLeftClose size={16} strokeWidth={1.75} />}
          </button>
          <label className="search">
            <Search size={16} strokeWidth={1.75} />
            <input
              value={query}
              placeholder="Search agents"
              aria-label="Search agents"
              onChange={event => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className="add-agent" aria-label="Add agent" onClick={() => { setProfileOpen(false); setCreateOpen(true); }}>
            <Plus size={16} strokeWidth={1.75} />
          </button>
        </div>
        <BotRail
          bots={visible}
          activeId={bot?.id}
          canDrag={!query.trim()}
          collapsed={railCollapsed}
          onSelect={openChat}
          onReorder={onReorder}
          onCreate={() => setCreateOpen(true)}
        />
        <footer className="you">
          <AccountMenu
            accountLabel={profile?.displayName || accountLabel}
            hint={profile?.handle ? `@${profile.handle}` : 'Account'}
            avatarUrl={avatarUrl}
            onPick={onAccount}
          />
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
          <article className={`bubble${pane === 'Positions' ? ' is-book' : ''}${pane === 'Plugins' ? ' is-plugins' : ''}`} aria-label={pane}>
            {pane === 'Main' ? (
              bot ? (
                <>
                  <header className="bubble-head">
                    <strong>{bot.name}</strong>
                    <span>{bot.type} · {bot.status}</span>
                  </header>
                  <h1>{bot.goal}</h1>
                  <section className="panel" aria-label="Stats">
                    <h2>Stats</h2>
                    <dl className="overview-metrics">
                      {buildBotStats(bot).cards.map(card => (
                        <div key={card.key}>
                          <dt>{card.label}</dt>
                          <dd>{card.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <LiveViewPanel botId={bot.id} ownerId={ownerId} />
                  {bot.experience ? <BotPage bot={bot} ownerId={ownerId} /> : null}
                  {bot.type === 'shopping' ? <ShoppingPanel bot={bot} ownerId={ownerId} /> : null}
                  <ChatBubbles botName={bot.name} lines={talks[bot.id] ?? []} thinking={thinkingBot === bot.id} />
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
            {pane === 'Logs' ? <LogsPanel bots={bots} /> : null}
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
            onThinking={on => setThinkingBot(on ? bot.id : null)}
            resolveMention={resolveMention}
          />
        ) : pane === 'Positions' ? null : <div className="composer-gap" />}
      </section>
      <CreateBotDialog open={createOpen} onClose={closeCreate} onCreate={onCreate} />
      <WalletsSheet open={walletsOpen} onClose={closeWallets} state={{ ...base, bots, wallets }} note={walletNote} />
      <ProfileSheet
        open={profileOpen}
        onClose={closeProfile}
        accountLabel={profile?.displayName || accountLabel}
        avatarUrl={avatarUrl}
        profile={profile}
        glance={glance}
        wallets={wallets}
        signedIn={signedIn}
        loginDisabled={loginDisabled}
        onLogin={onLogin}
        onLogout={onLogout}
        onSave={saveProfile}
      />
    </div>
  );
}
