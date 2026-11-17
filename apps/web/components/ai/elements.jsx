'use client';

import { useState } from 'react';
import { CircleCheck, FileText, LoaderCircle, Search, Terminal } from 'lucide-react';
import { CodeBlock, CodeBlockContent } from '../ui/code-block';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '../ui/trace';
import './elements.css';

function traceStatus(status) {
  if (status === 'running') return 'running';
  if (status === 'error') return 'error';
  if (status === 'idle') return 'pending';
  return undefined;
}

function ReasoningRow({ text = '', streaming = false }) {
  const [open, setOpen] = useState();
  const body = String(text || '').trim();
  const line = (
    <TraceLine status={streaming ? 'running' : undefined}>
      <TraceIcon>
        {streaming ? <LoaderCircle className="animate-spin" /> : <CircleCheck />}
      </TraceIcon>
      <TraceTitle>{streaming ? 'Thinking' : 'Thought'}</TraceTitle>
    </TraceLine>
  );
  if (!body) return line;
  return (
    <TraceCollapsible open={open ?? streaming} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{body}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function Reasoning({ text = '', streaming = false }) {
  const body = String(text || '').trim();
  if (!streaming && !body) return null;
  return (
    <Trace>
      <ReasoningRow text={body} streaming={streaming} />
    </Trace>
  );
}

function Output({ text, failed = false }) {
  if (!text) return null;
  return (
    <CodeBlock size="sm" variant={failed ? 'destructive' : 'default'}>
      <CodeBlockContent wrap className="max-h-64">{text}</CodeBlockContent>
    </CodeBlock>
  );
}

export function ToolCall({ name, input, status }) {
  const failed = status === 'error';
  const running = status === 'running';
  const line = (
    <TraceLine status={traceStatus(status)}>
      <TraceIcon>
        <Terminal />
      </TraceIcon>
      <TraceTitle>{running ? `Running ${name}` : failed ? `Failed ${name}` : name}</TraceTitle>
    </TraceLine>
  );
  if (!input) return line;
  return (
    <TraceCollapsible defaultOpen={failed || running}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Output text={input} failed={failed} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function TerminalBlock({ command, status }) {
  const failed = status === 'error';
  const running = status === 'running';
  const title = running ? `Running ${command}` : failed ? `${command} failed` : `Ran ${command}`;
  return (
    <Trace>
      <TraceCollapsible defaultOpen={running || failed}>
        <TraceCollapsibleTrigger>
          <TraceLine status={traceStatus(status)}>
            <TraceIcon>
              <Terminal />
            </TraceIcon>
            <TraceTitle>{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Output text={command} failed={failed} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export function ChainOfThought({ sections = [], onSelect }) {
  if (sections.length === 0) return null;
  return (
    <Trace>
      {sections.map((section) => (
        <TraceCollapsible key={section.value} defaultOpen>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceTitle>{section.label}</TraceTitle>
              <TraceDescription>{section.children?.length ?? 0}</TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <Trace>
              {(section.children || []).map((child) => (
                <button
                  key={child.value}
                  type="button"
                  className="w-fit border-0 bg-transparent p-0 text-left"
                  onClick={() => onSelect?.(child.value)}
                >
                  <TraceLine status="pending">
                    <TraceTitle>{child.label}</TraceTitle>
                  </TraceLine>
                </button>
              ))}
            </Trace>
          </TraceCollapsibleContent>
        </TraceCollapsible>
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

function SearchRow({ label, sites = [], icon = null }) {
  const line = (
    <TraceLine>
      <TraceIcon>
        {icon || <Search />}
      </TraceIcon>
      <TraceTitle>{label}</TraceTitle>
      {sites.length > 0 ? <TraceDescription>{sites.length}</TraceDescription> : null}
    </TraceLine>
  );
  if (sites.length === 0) return line;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="agent-sites">
          {sites.map((site) => <SiteChip key={site.url} site={site} />)}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function AgentTrace({ steps = [] }) {
  if (!steps.length) return null;
  return (
    <Trace className="agent-trace">
      {steps.map((step, index) => {
        const key = `${step.kind}-${index}`;
        if (step.kind === 'think') return <ReasoningRow key={key} text={step.text} />;
        if (step.kind === 'search') {
          return (
            <SearchRow
              key={key}
              label={step.query ? `Searched ${step.query}` : 'Searched the web'}
              sites={step.sites}
            />
          );
        }
        if (step.kind === 'page') {
          return (
            <SearchRow
              key={key}
              label={step.label}
              icon={<FileText />}
              sites={[{ title: step.title || step.host, url: step.url, host: step.host }]}
            />
          );
        }
        return (
          <ToolCall
            key={key}
            name={step.label}
            input={step.detail}
            status={step.status === 'error' ? 'error' : undefined}
          />
        );
      })}
    </Trace>
  );
}

export function Sources({ urls = [] }) {
  if (urls.length === 0) return null;
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <FileText />
            </TraceIcon>
            <TraceTitle>Sources</TraceTitle>
            <TraceDescription>{urls.length}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {urls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="max-w-full">
                <TraceLine>
                  <TraceTitle>{url}</TraceTitle>
                </TraceLine>
              </a>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
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
