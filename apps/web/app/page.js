'use client';

import { useState } from 'react';
import TalkStub from '../components/TalkStub';
import { getDemoShellState } from '../lib/demo-state.mjs';

const state = getDemoShellState();

export default function HomePage() {
  const [activeBot, setActiveBot] = useState(state.bots[0].id);
  const [pane, setPane] = useState('Overview');
  const bot = state.bots.find(item => item.id === activeBot) ?? state.bots[0];

  return (
    <div className="shell">
      <aside className="bots">
        <div className="brand">
          Mael<span>strom</span>
        </div>
        <div className="bot-list" role="list">
          {state.bots.map(item => (
            <button
              key={item.id}
              className="bot-item"
              role="listitem"
              aria-current={item.id === activeBot ? 'true' : undefined}
              onClick={() => setActiveBot(item.id)}
            >
              <strong>{item.name}</strong>
              <small>{item.type} · {item.status}</small>
            </button>
          ))}
        </div>
        <button className="cta" type="button">Create bot</button>
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
          <button className="cta" type="button">Connect with Privy</button>
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

          <div className="grid">
            <section className="panel" aria-label="Live timeline">
              <h2>Live timeline</h2>
              <ul className="timeline">
                {state.timeline.map(event => (
                  <li key={event.at + event.summary}>
                    <time>{event.at}</time>
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel" aria-label="Approvals">
              <h2>Approvals</h2>
              <ul className="timeline">
                {state.approvals.map(item => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.state}</span>
                  </li>
                ))}
              </ul>
              <p style={{ color: 'var(--muted)', marginBottom: 0 }}>
                Live View wires in once Browser Rendering sessions are live.
              </p>
            </section>
          </div>

          <TalkStub botName={bot.name} />
        </section>
      </main>
    </div>
  );
}
