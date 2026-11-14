'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { enableBot } from '@ubc2026/bot-creation';
import BotCreation from '../components/BotCreation';
import TalkStub from '../components/TalkStub';
import LiveViewPanel from '../components/LiveViewPanel';
import { getDemoShellState, panePlaceholder } from '../lib/demo-state.mjs';
import { ownerIdFromPrivyUser, privyAccountLabel, privyProviderProps } from '../lib/privy-config.mjs';

const state = getDemoShellState();
const privyConfigured = privyProviderProps({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
}) !== null;

export default function HomePage() {
  if (!privyConfigured) {
    return (
      <Shell
        ownerId={null}
        account={(
          <div className="account">
            <span className="account-id">Set NEXT_PUBLIC_PRIVY_APP_ID</span>
            <button className="cta" type="button" disabled>Connect with Privy</button>
          </div>
        )}
      />
    );
  }
  return <AuthedShell />;
}

function AuthedShell() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const signedIn = ready && authenticated;
  const ownerId = ownerIdFromPrivyUser(user, signedIn);
  const account = !ready ? (
    <button className="cta" type="button" disabled>Connect with Privy</button>
  ) : signedIn ? (
    <div className="account">
      <span className="account-id">{privyAccountLabel(user)}</span>
      <button className="ghost" type="button" onClick={() => logout()}>Log out</button>
    </div>
  ) : (
    <button className="cta" type="button" onClick={() => login()}>Connect with Privy</button>
  );
  return <Shell ownerId={ownerId} account={account} />;
}

function Shell({ ownerId, account }) {
  const owner = ownerId ?? 'demo_owner';
  const [bots, setBots] = useState(state.bots);
  const [userTemplates, setUserTemplates] = useState([]);
  const [creating, setCreating] = useState(false);
  const [activeBot, setActiveBot] = useState(state.bots[0].id);
  const [pane, setPane] = useState(state.panes[0]);
  const bot = bots.find(item => item.id === activeBot) ?? bots[0];
  const placeholder = panePlaceholder(pane);

  function addDraft(draft) {
    setBots(current => [
      ...current.filter(item => item.id !== draft.id),
      { id: draft.id, name: draft.name, type: draft.type, status: 'draft', goal: draft.goal, record: draft },
    ]);
    setActiveBot(draft.id);
  }

  function enableDraft(record) {
    const next = enableBot(record);
    setBots(current => current.map(item => (
      item.id === record.id ? { ...item, status: 'enabled', record: next } : item
    )));
  }

  return (
    <div className="shell">
      <aside className="bots">
        <div className="brand">
          Mael<span>strom</span>
        </div>
        <div className="bot-list" role="list">
          {bots.map(item => (
            <div
              key={item.id}
              className="bot-item"
              role="listitem"
              aria-current={item.id === activeBot ? 'true' : undefined}
            >
              <button type="button" className="bot-select" onClick={() => setActiveBot(item.id)}>
                <strong>{item.name}</strong>
                <small>{item.type} · {item.status}</small>
              </button>
              {item.record && item.record.enabled === false ? (
                <button type="button" className="ghost" onClick={() => enableDraft(item.record)}>Enable</button>
              ) : null}
            </div>
          ))}
        </div>
        <button className="cta" type="button" aria-expanded={creating} onClick={() => setCreating(open => !open)}>
          {creating ? 'Close creation' : 'Create bot'}
        </button>
      </aside>

      <main className="main">
        <header className="top">
          <nav className="panes" aria-label="Panes">
            {state.panes.map(name => (
              <button
                key={name}
                className="pane-tab"
                aria-current={pane === name ? 'true' : undefined}
                onClick={() => setPane(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          {account}
        </header>

        <section className="content">
          <div className="hero-panel">
            <div className="pill">● {pane} · {bot.name}</div>
            <h1>{bot.goal}</h1>
            <p>
              Budget-aware Solana agents with trust gates, independent verification,
              and Phantom-style approvals before every spend.
            </p>
          </div>

          {creating ? (
            <BotCreation
              ownerId={owner}
              userTemplates={userTemplates}
              onTemplatesChange={setUserTemplates}
              onDraft={addDraft}
            />
          ) : null}

          <section className="panel empty-pane" aria-label={placeholder.title}>
            <h2>{placeholder.title}</h2>
            <p>{placeholder.body}</p>
          </section>

          <section className="panel" aria-label="Live View">
            <LiveViewPanel botId={bot.id} ownerId={ownerId} />
          </section>
          <TalkStub botName={bot.name} />
        </section>
      </main>
    </div>
  );
}
