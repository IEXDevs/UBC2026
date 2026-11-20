'use client';

import { useEffect, useState } from 'react';
import { Pause, Play, Snowflake } from 'lucide-react';
import { securityAgent, securityPauseStatus, setSecurityPause, setSecurityFreeze } from '../lib/security.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import SlideCommit from './bits/SlideCommit';
import './SecurityPanel.css';

export default function SecurityPanel({ bots, ownerId, getAccessToken, onPolicyChange }) {
  const [paused, setPaused] = useState({});
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(null);
  const [message, setMessage] = useState('');
  const agents = bots.map(securityAgent);
  const activeIds = JSON.stringify(agents.filter(agent => !agent.draft).map(agent => agent.id));
  const disabled = busy || !ownerId;

  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    async function load() {
      const headers = await ownerAuthHeaders(ownerId, getAccessToken);
      const entries = await Promise.all(JSON.parse(activeIds).map(async id => (
        [id, await securityPauseStatus(id, headers, controller.signal)]
      )));
      if (controller.signal.aborted) return;
      setPaused(current => ({
        ...Object.fromEntries(entries.filter(([, value]) => value !== null)),
        ...current,
      }));
    }
    load();
    return () => controller.abort();
  }, [activeIds, ownerId, getAccessToken]);

  async function runAction({ kind, agent, value }) {
    setArmed(null);
    setBusy(true);
    setMessage('');
    try {
      const headers = await ownerAuthHeaders(ownerId, getAccessToken, {
        'content-type': 'application/json',
      });
      const verb = kind === 'pause' ? (value ? 'pause' : 'resume') : (value ? 'freeze' : 'unfreeze');
      let ok;
      let count;
      if (kind === 'pause') {
        const targets = agent ? [agent.id] : agents.filter(item => !item.draft).map(item => item.id);
        const result = await setSecurityPause(targets, value, headers);
        setPaused(current => ({ ...current, ...Object.fromEntries(result.ids.map(id => [id, value])) }));
        if (result.ids.length) onPolicyChange(result.ids.map(botId => ({ botId, enabled: !value })));
        ({ ok } = result);
        count = result.ids.length;
      } else {
        const result = await setSecurityFreeze(agent?.id, value, headers);
        if (result.items.length) onPolicyChange(result.items);
        ({ ok } = result);
        count = result.items.length;
      }
      if (!ok) setMessage(count ? `Could only ${verb} ${count} agents.` : `Could not ${verb} ${agent?.name || 'agents'}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel security-page" aria-label="Security" aria-busy={busy}>
      <h2>Security</h2>
      <div className="security-bulk">
        <button type="button" className="security-action" disabled={disabled || !agents.some(agent => !agent.draft)}
          onClick={() => setArmed({ kind: 'pause', value: true, label: 'Pause all agents?' })}>
          <Pause size={16} aria-hidden="true" /> Pause all
        </button>
        <button type="button" className="security-action security-freeze" disabled={disabled || !agents.some(agent => !agent.draft && !agent.frozen)}
          onClick={() => setArmed({ kind: 'freeze', value: true, label: 'Block spending for all agents?' })}>
          <Snowflake size={16} aria-hidden="true" /> Freeze all
        </button>
      </div>

      {armed && (
        <div className="security-confirm" role="group" aria-label={armed.label}>
          <p>{armed.label}</p>
          <SlideCommit key={armed.label} label="Slide to confirm" disabled={busy} onCommit={() => runAction(armed)} />
          <button type="button" className="security-action" onClick={() => setArmed(null)}>Cancel</button>
        </div>
      )}
      {message && <p className="security-notice" role="status">{message}</p>}

      {agents.length ? (
        <ul className="security-agent-list" aria-label="Agents">
          {agents.map(agent => {
            const isPaused = agent.disabled || paused[agent.id] === true;
            const Playback = isPaused ? Play : Pause;
            const playbackLabel = `${isPaused ? 'Resume' : 'Pause'} ${agent.name}`;
            const freezeLabel = agent.frozen ? 'Unfreeze' : 'Freeze';
            const unavailable = disabled || agent.draft;
            return (
              <li key={agent.id}>
                <strong>{agent.name}</strong>
                <div className="security-row-actions">
                  <button type="button" className="security-action security-playback" aria-label={playbackLabel}
                    title={agent.frozen ? `Unfreeze ${agent.name} before resuming` : playbackLabel}
                    disabled={unavailable || agent.frozen}
                    onClick={() => runAction({ kind: 'pause', agent, value: !isPaused })}>
                    <Playback size={17} aria-hidden="true" />
                  </button>
                  <button type="button" className={`security-action ${agent.frozen ? '' : 'security-freeze'}`}
                    aria-label={`${freezeLabel} ${agent.name}`} disabled={unavailable}
                    onClick={() => {
                      const action = { kind: 'freeze', agent, value: !agent.frozen };
                      if (agent.frozen) setArmed({ ...action, label: `Allow ${agent.name} to spend again?` });
                      else runAction(action);
                    }}>
                    <Snowflake size={16} aria-hidden="true" /> {freezeLabel}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="security-notice">No agents yet.</p>}
    </section>
  );
}
