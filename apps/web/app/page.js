'use client';

import { useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { enableBot } from '@ubc2026/bot-creation';
import BotCreation from '../components/BotCreation';
import BotPage from '../components/BotPage';
import OverviewPanel from '../components/OverviewPanel';
import SecurityPanel from '../components/SecurityPanel';
import TalkStub from '../components/TalkStub';
import { getDemoShellState, panePlaceholder } from '../lib/demo-state.mjs';
import { ownerIdFromPrivyUser, privyAccountLabel, privyProviderProps } from '../lib/privy-config.mjs';
import { createVoiceClientTools } from '../lib/voice-client-tools.mjs';
import { createConversationLog } from '../lib/voice-conversation.mjs';

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
  const label = signedIn ? privyAccountLabel(user) : null;
  const account = !ready ? (
    <button className="cta" type="button" disabled>Connect with Privy</button>
  ) : signedIn ? (
    <div className="account">
      <span className="account-id">{label}</span>
      <button className="ghost" type="button" onClick={() => logout()}>Log out</button>
    </div>
  ) : (
    <button className="cta" type="button" onClick={() => login()}>Connect with Privy</button>
  );
  return <Shell ownerId={ownerId} account={account} accountLabel={label} />;
}

function Shell({ ownerId, account, accountLabel = null }) {
  const owner = ownerId ?? 'demo_owner';
  const [bots, setBots] = useState(state.bots);
  const [userTemplates, setUserTemplates] = useState([]);
  const [creating, setCreating] = useState(false);
  const [activeBot, setActiveBot] = useState(state.bots[0].id);
  const [pane, setPane] = useState('Agents');
  const conversation = useMemo(() => createConversationLog(), []);
  const bot = bots.find(item => item.id === activeBot) ?? bots[0];
  const placeholder = panePlaceholder(pane);
  const showHero = pane !== 'Agents' && pane !== 'Overview' && pane !== 'Security';
  const clientTools = useMemo(() => createVoiceClientTools({
    bots,
    activeBotId: activeBot,
    pane,
    setActiveBotId: (id) => {
      setActiveBot(id);
      const named = bots.find((item) => item.id === id);
      conversation.push({ kind: 'open_bot', text: `Opened ${named?.name || id}`, botId: id });
    },
    setPane: (name) => {
      setPane(name);
      conversation.push({ kind: 'pane', text: `Switched to ${name}` });
    },
    focusLiveView: () => {
      setPane('Agents');
      conversation.push({ kind: 'live_view', text: `Live View focused for ${bot.name}`, botId: bot.id });
    },
    pushEvent: (event) => {
      if (event?.kind === 'client.confirm') {
        conversation.push({
          kind: 'confirm',
          text: event.accepted ? `Confirmed ${event.actionId || 'action'}` : `Rejected ${event.actionId || 'action'}`,
        });
      }
    },
    approvalSummary: bot.experience?.preview?.state === 'approval-needed'
      ? `${bot.name} waits for approval.`
      : null,
    conversation,
  }), [bots, activeBot, pane, conversation, bot.name, bot.id, bot.experience?.preview?.state]);

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
              <button type="button" className="bot-select" onClick={() => { setActiveBot(item.id); setPane('Agents'); }}>
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
          {showHero && (
            <div className="hero-panel">
              <div className="pill">● {pane} · {bot.name}</div>
              <h1>{bot.goal}</h1>
              <p>
                Budget-aware Solana agents with trust gates, independent verification,
                and Phantom-style approvals before every spend.
              </p>
            </div>
          )}

          {creating ? (
            <BotCreation
              ownerId={owner}
              userTemplates={userTemplates}
              onTemplatesChange={setUserTemplates}
              onDraft={addDraft}
            />
          ) : null}

          {pane === 'Agents' ? (
            <BotPage
              bot={bot}
              ownerId={ownerId}
              onConversationEvent={(event) => {
                if (event?.summary) {
                  conversation.push({
                    kind: event.kind || 'timeline',
                    text: event.summary,
                    botId: bot.id,
                  });
                }
              }}
            />
          ) : pane === 'Overview' ? (
            <OverviewPanel bots={bots} ownerId={ownerId} />
          ) : pane === 'Security' ? (
            <SecurityPanel
              bots={bots}
              ownerId={ownerId}
              accountLabel={accountLabel}
              onBotsChange={(next) => {
                setBots(next);
                conversation.push({ kind: 'security', text: 'Security action applied to bots' });
              }}
            />
          ) : (
            <section className="panel empty-pane" aria-label={placeholder.title}>
              <h2>{placeholder.title}</h2>
              <p>{placeholder.body}</p>
            </section>
          )}
          <TalkStub botName={bot.name} clientTools={clientTools} conversation={conversation} />
        </section>
      </main>
    </div>
  );
}
