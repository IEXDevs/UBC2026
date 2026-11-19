'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import './GlideSelect.css';

export default function RecallSearch({ query, hits = [], onQuery, onSelect }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const id = useId();
  const shown = open && query.trim().length > 0;
  const rows = hits.length > 0 ? hits : [{ id: 'none', label: 'No matches', tag: '', disabled: true }];

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!shown) return undefined;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [shown]);

  function choose(index) {
    const hit = rows[index];
    if (!hit || hit.disabled) return;
    setOpen(false);
    onSelect?.(hit);
  }

  function onKeyDown(event) {
    if (!shown && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      if (query.trim()) setOpen(true);
      return;
    }
    if (!shown) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(current => (current + step + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="glide-select recall-search"
      data-open={shown ? '' : undefined}
      style={{
        '--gs-accent': '#f5f5f5',
        '--gs-surface': '#27272a',
        '--gs-highlight': '#3f3f46',
        '--gs-text': '#f5f5f5',
        '--gs-radius': '10px',
        '--gs-inner-radius': '6px',
        '--gs-chip': '36px',
        '--gs-row': '32px',
        '--gs-font': '13px',
        '--gs-menu-w': '100%',
      }}
    >
      <label className="glide-select__trigger" htmlFor={`${id}-input`}>
        <Search size={14} strokeWidth={1.75} aria-hidden="true" />
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${id}-${active}` : undefined}
          aria-label="Search agents, chats, messages, and files"
          placeholder="Search agents, chats, files"
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {shown ? (
        <div className="glide-select__menu" data-state="open" data-side="bottom" data-align="left">
          <div id={`${id}-list`} role="listbox" aria-label="Search results" className="glide-select__list" data-live="">
            {rows.map((hit, index) => (
              <button
                key={hit.id}
                id={`${id}-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                disabled={hit.disabled || undefined}
                className="glide-select__option"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span className="glide-select__name">{hit.label}</span>
                {hit.tag ? <span className="glide-select__tag">{hit.tag}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
