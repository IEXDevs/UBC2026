'use client';

import { useState } from 'react';
import { Orb } from '@yogesharc/thinking-orbs';
import { chatOrbLook } from '../../lib/voice-orb.mjs';
import { Trace, TraceDescription, TraceLine, TraceTitle } from '../ui/trace';
import './elements.css';

function traceStatus(status) {
  if (status === 'running') return 'running';
  if (status === 'error') return 'error';
  if (status === 'idle') return 'pending';
  return undefined;
}

export function Reasoning({ text = '', streaming = false }) {
  const [open, setOpen] = useState(Boolean(streaming));
  const look = chatOrbLook('think');
  return (
    <Trace>
      <button type="button" className="w-fit border-0 bg-transparent p-0 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <TraceLine status={streaming ? 'running' : undefined}>
          {streaming ? <Orb state={look.state} variant={look.variant} size={16} label={look.label} /> : null}
          <TraceTitle>{streaming ? 'Thinking' : 'Thought'}</TraceTitle>
        </TraceLine>
      </button>
      {open && text ? <p className="m-0 max-w-full pl-1 text-sm leading-relaxed text-muted-foreground">{text}</p> : null}
    </Trace>
  );
}

export function ToolCall({ name, input, status }) {
  return (
    <Trace>
      <TraceLine status={traceStatus(status)}>
        <TraceTitle>{name}</TraceTitle>
        {input ? <TraceDescription>{input}</TraceDescription> : null}
      </TraceLine>
    </Trace>
  );
}

export function TerminalBlock({ command, status }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="px-3 pt-2">
        <Trace>
          <TraceLine status={traceStatus(status)}>
            <TraceTitle>Terminal</TraceTitle>
          </TraceLine>
        </Trace>
      </div>
      <pre className="m-0 overflow-x-auto px-3 py-2 text-xs text-foreground">{command}</pre>
    </div>
  );
}

export function ChainOfThought({ sections = [], onSelect }) {
  if (sections.length === 0) return null;
  return (
    <Trace>
      {sections.map((section) => (
        <div key={section.value} className="flex flex-col gap-1">
          <TraceLine>
            <TraceTitle>{section.label}</TraceTitle>
            <TraceDescription>{section.children?.length ?? 0}</TraceDescription>
          </TraceLine>
          {(section.children || []).map((child) => (
            <button
              key={child.value}
              type="button"
              className="w-fit border-0 bg-transparent p-0 pl-4 text-left"
              onClick={() => onSelect?.(child.value)}
            >
              <TraceLine status="pending">
                <TraceTitle>{child.label}</TraceTitle>
              </TraceLine>
            </button>
          ))}
        </div>
      ))}
    </Trace>
  );
}

export function TaskList({ items }) {
  if (!items?.length) return null;
  return (
    <Trace>
      {items.map((item) => (
        <div key={item.id} className="flex items-start justify-between gap-3">
          <TraceLine status={traceStatus(item.status)}>
            <TraceTitle>{item.title}</TraceTitle>
          </TraceLine>
          {item.action}
        </div>
      ))}
    </Trace>
  );
}

function faviconFor(host) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function SiteChip({ site }) {
  const label = site.title || site.host;
  return (
    <a className="agent-site" href={site.url} target="_blank" rel="noreferrer">
      <img
        alt=""
        width="16"
        height="16"
        src={faviconFor(site.host)}
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
      <span>{label}</span>
    </a>
  );
}

export function AgentTrace({ steps = [] }) {
  if (!steps.length) return null;
  return (
    <div className="agent-trace">
      {steps.map((step, index) => {
        const key = `${step.kind}-${index}`;
        if (step.kind === 'think') return <Reasoning key={key} text={step.text} />;
        if (step.kind === 'search') {
          return (
            <div key={key} className="agent-search">
              <p className="agent-search-label">{step.query ? `Searched ${step.query}` : 'Searched the web'}</p>
              {step.sites.length > 0 ? (
                <div className="agent-sites">
                  {step.sites.map((site) => <SiteChip key={site.url} site={site} />)}
                </div>
              ) : null}
            </div>
          );
        }
        if (step.kind === 'page') {
          return (
            <div key={key} className="agent-search">
              <p className="agent-search-label">{step.label}</p>
              <div className="agent-sites">
                <SiteChip site={step} />
              </div>
            </div>
          );
        }
        return <ToolCall key={key} name={step.label} input={step.detail} status={step.status === 'error' ? 'error' : undefined} />;
      })}
    </div>
  );
}

export function Sources({ urls = [] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">Sources</span>
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="max-w-full truncate text-foreground underline-offset-2 hover:underline">
          {url}
        </a>
      ))}
    </div>
  );
}

export function Suggestion({ children, onClick }) {
  return (
    <button
      type="button"
      className="rounded-full border border-border bg-transparent px-3 py-1.5 text-sm text-foreground hover:bg-muted"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Confirmation({ title, children, actions }) {
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-sm text-foreground">
      <div className="font-medium">{title}</div>
      {children}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
