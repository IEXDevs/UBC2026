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
import PaneDock from '../components/PaneDock';
import ChatBubbles from '../components/ChatBubbles';
import Composer from '../components/Composer';
import CreateBotDialog from '../components/CreateBotDialog';
import ProfileSheet from '../components/ProfileSheet';
import WalletsSheet from '../components/WalletsSheet';
import { getDemoShellState } from '../lib/demo-state.mjs';
import { moneyPane, walletGlance } from '../lib/money-views.mjs';
import { applyLooks } from '../lib/bot-look.mjs';
import { mergeRoster, removeBotFromRoster, reorderIds } from '../lib/roster.mjs';
import { ownerIdFromPrivyUser, privyAccountLabel, privyProviderProps, sessionReadyForWallets } from '../lib/privy-config.mjs';
import { withAssignedWallet } from '../lib/wallet-assign.mjs';
import { parseRecipient, privyAvatarUrl } from '@ubc2026/contracts';
import { buildBotStats } from '../lib/overview.mjs';
import { walletProvisionNote, walletsFromPrivyUser } from '../lib/wallet-provision.mjs';
import {
  deleteOwnerBot,
  emptyMoneyState,
  fetchOwnerLists,
  runtimeBaseUrl,
  shellBotFromRemote,
} from '../lib/runtime-data.mjs';

/** Catalog only — panes + connector list. Never seed bots/wallets/payments from this. */
const catalog = getDemoShellState();
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
    // getAccessToken() can erase the Privy session while the terms screen is open.
    if (!sessionReadyForWallets(signedIn, user)) return undefined;
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
          setLiveWallets([]);
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
            setLiveWallets([]);
            setWalletNote(walletProvisionNote({}, { ok: false }));
          }
        }
      }
    })();
    return () => { stopped = true; };
  }, [signedIn, user?.id, user?.hasAcceptedTerms, getAccessToken]);

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
  const [roster, setRoster] = useState({ order: [], extra: [] });
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [activeBot, setActiveBot] = useState(null);
  const [pane, setPane] = useState('Main');
  const [slide, setSlide] = useState('right');
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [talks, setTalks] = useState({});
  const [thinkingBot, setThinkingBot] = useState(null);
  const [remoteBots, setRemoteBots] = useState([]);
  const [remotePayments, setRemotePayments] = useState([]);
  const [remoteWallets, setRemoteWallets] = useState([]);
  const [dataNote, setDataNote] = useState('');
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
    () => catalog.panes.filter((name) => name !== 'Plugins'),
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
    setLooks(savedLooks);
    // Only keep locally created extras — never rehydrate the old demo bot ids.
    const extras = savedRoster && Array.isArray(savedRoster.extra) ? savedRoster.extra : [];
    const order = savedRoster && Array.isArray(savedRoster.order) ? savedRoster.order : [];
    setRoster({ order, extra: extras });
    setActiveBot(null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(LOOK_KEY, JSON.stringify(looks));
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  }, [looks, roster, ready]);

  useEffect(() => {
    if (!signedIn || !ownerId) {
      setRemoteBots([]);
      setRemotePayments([]);
      setRemoteWallets([]);
      setDataNote('');
      return undefined;
    }
    const runtimeBase = runtimeBaseUrl();
    if (!runtimeBase) {
      setDataNote('Set NEXT_PUBLIC_AGENT_RUNTIME_URL to load live bots and payments.');
      return undefined;
    }
    let stop = false;
    async function load() {
      try {
        const lists = await fetchOwnerLists(ownerId, runtimeBase);
        if (stop) return;
        setRemoteBots(lists.bots);
        setRemotePayments(lists.payments);
        setRemoteWallets(lists.wallets);
        setDataNote(lists.source === 'unconfigured'
          ? 'Worker is up but Supabase is not configured on the runtime.'
          : '');
      } catch {
        if (!stop) setDataNote('Could not reach the Worker API.');
      }
    }
    load();
    const timer = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [signedIn, ownerId]);

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
    const runtimeBase = runtimeBaseUrl();
    if (!runtimeBase) return undefined;
    let stop = false;
    (async () => {
      try {
        const response = await fetch(`${runtimeBase}/api/profiles/me`, {
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
    const runtimeBase = runtimeBaseUrl();
    if (runtimeBase && ownerId) {
      const response = await fetch(`${runtimeBase}/api/profiles/me`, {
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
    const runtimeBase = runtimeBaseUrl();
    if (runtimeBase && ownerId) {
      try {
        const url = new URL(`${runtimeBase}/api/profiles/lookup`);
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
    if (!signedIn) return [];
    const fromRemote = remoteBots.map(row => shellBotFromRemote(row, looks)).filter(Boolean);
    return fromRemote;
  }, [signedIn, remoteBots, looks]);

  const merged = useMemo(() => mergeRoster(seedBots, signedIn ? roster : { order: [], extra: [] }), [roster, seedBots, signedIn]);
  const styled = useMemo(() => applyLooks(merged.bots, looks), [merged, looks]);
  const provisioned = Array.isArray(liveWallets) ? liveWallets : null;
  const listed = remoteWallets.length > 0 ? remoteWallets : null;
  const assigned = useMemo(
    () => withAssignedWallet(styled, provisioned || listed || []),
    [styled, provisioned, listed],
  );
  const bots = signedIn ? assigned.bots : [];
  const wallets = signedIn ? (assigned.wallets || provisioned || listed || []) : [];
  const payments = signedIn ? remotePayments : [];
  const positions = [];
  const moneyState = signedIn
    ? { bots, wallets, payments, positions }
    : emptyMoneyState();
  const visible = bots.filter(bot => bot.name.toLowerCase().includes(query.trim().toLowerCase()));
  const bot = bots.find(item => item.id === activeBot) ?? null;
  const money = moneyPane(pane);
  const glance = walletGlance(wallets, positions);
  const walletChipLabel = !signedIn
    ? 'Sign in'
    : (wallets.length ? glance.balanceLabel : 'No wallet');

  useEffect(() => {
    if (!signedIn) {
      setActiveBot(null);
      return;
    }
    if (activeBot && bots.some(item => item.id === activeBot)) return;
    setActiveBot(bots[0]?.id ?? null);
  }, [signedIn, bots, activeBot]);

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
    if (!signedIn) {
      onLogin?.();
      return;
    }
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

  async function onDeleteBot(botId) {
    if (!signedIn || typeof botId !== 'string' || !botId) return;
    const target = bots.find(item => item.id === botId);
    if (!target) return;
    if (!window.confirm(`Delete ${target.name}? This removes the agent and its stored ledger rows.`)) return;

    const isRemote = Boolean(target.record);
    if (isRemote && ownerId) {
      const result = await deleteOwnerBot(ownerId, botId);
      if (!result.ok) {
        setDataNote(`Could not delete agent (${result.error}).`);
        return;
      }
      setRemoteBots(current => current.filter(row => row.id !== botId));
      setRemotePayments(current => current.filter(row => row.botId !== botId));
    }

    setRoster(current => removeBotFromRoster(current, botId));
    setLooks(current => {
      if (!current || !current[botId]) return current;
      const next = { ...current };
      delete next[botId];
      return next;
    });
    setTalks(current => {
      if (!current || !current[botId]) return current;
      const next = { ...current };
      delete next[botId];
      return next;
    });
    setActiveBot(current => (current === botId ? null : current));
    setDataNote('');
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

  function openCreate() {
    if (!signedIn) {
      onLogin?.();
      return;
    }
    setProfileOpen(false);
    setCreateOpen(true);
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
          <button type="button" className="add-agent" aria-label="Add agent" onClick={openCreate}>
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
          onCreate={openCreate}
          onDelete={onDeleteBot}
        />
        <footer className="you">
          <AccountMenu
            accountLabel={profile?.displayName || accountLabel}
            hint={signedIn ? (profile?.handle ? `@${profile.handle}` : 'Account') : 'Not signed in'}
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
            onClick={() => {
              if (!signedIn) {
                onLogin?.();
                return;
              }
              setCreateOpen(false);
              setProfileOpen(false);
              setWalletsOpen(true);
            }}
          >
            <Wallet size={16} strokeWidth={1.75} />
            <span>{walletChipLabel}</span>
          </button>
        </header>
        <div key={`${pane}-${slide}`} className={`thread slide-${slide}${pane === 'Positions' ? ' is-book' : ''}`}>
          <article className={`bubble${pane === 'Positions' ? ' is-book' : ''}${pane === 'Plugins' ? ' is-plugins' : ''}`} aria-label={pane}>
            {pane === 'Main' ? (
              !signedIn ? (
                <>
                  <h1>Sign in to run agents</h1>
                  <p>Connect with Privy to load your wallets, bots, and live Worker data. Nothing here is a preview of someone else’s account.</p>
                  <button type="button" className="solid" disabled={loginDisabled} onClick={onLogin}>Connect</button>
                </>
              ) : bot ? (
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
                  <BotPage bot={bot} ownerId={ownerId} />
                  <ChatBubbles botName={bot.name} lines={talks[bot.id] ?? []} thinking={thinkingBot === bot.id} />
                </>
              ) : (
                <>
                  <h1>Make your first Agent!</h1>
                  <p>{dataNote || 'Your bot list is empty. Create one or wait for the Worker to return bots from Supabase.'}</p>
                  <button type="button" className="solid" onClick={openCreate}>Create</button>
                </>
              )
            ) : null}
            {money ? (
              <MoneyPane
                pane={money}
                state={moneyState}
                signedIn={signedIn}
                onSignIn={onLogin}
                note={signedIn ? (walletNote || dataNote) : ''}
              />
            ) : null}
            {pane === 'Plugins' ? <ConnectorsPane connectors={catalog.connectors} bots={bots} /> : null}
            {pane === 'Logs' ? <LogsPanel bots={bots} ownerId={ownerId} /> : null}
            {pane === 'Security' ? (
              <SecurityPanel
                bots={bots}
                ownerId={ownerId}
                accountLabel={accountLabel}
                wallets={wallets}
                onBotsChange={(next) => {
                  // Local status toggles only — remote list refreshes on the next poll.
                  setRemoteBots(current => current.map(row => {
                    const updated = next.find(bot => bot.id === row.id);
                    if (!updated) return row;
                    return {
                      ...row,
                      enabled: updated.status !== 'paused' && updated.enabled !== false,
                      frozen: updated.status === 'paused' || updated.frozen === true,
                    };
                  }));
                }}
              />
            ) : null}
          </article>
        </div>
        {bot ? (
          <Composer
            key={bot.id}
            hidden={pane !== 'Main'}
            botId={bot.id}
            botName={bot.name}
            botGoal={bot.goal}
            botType={bot.type}
            ownerId={ownerId}
            lines={talks[bot.id] ?? []}
            onLine={line => appendTalk(bot.id, line)}
            onThinking={on => setThinkingBot(on ? bot.id : null)}
            resolveMention={resolveMention}
          />
        ) : pane === 'Positions' ? null : <div className="composer-gap" />}
      </section>
      <CreateBotDialog open={createOpen} onClose={closeCreate} onCreate={onCreate} />
      <WalletsSheet
        open={walletsOpen}
        onClose={closeWallets}
        state={moneyState}
        note={signedIn ? walletNote : 'Sign in to provision and list your Privy wallets.'}
        signedIn={signedIn}
        onSignIn={onLogin}
      />
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
