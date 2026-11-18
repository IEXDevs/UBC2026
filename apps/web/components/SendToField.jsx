'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './GlideSelect.css';

export default function SendToField({ value, destinations = [], selectedId = '', onChange, onPick }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const id = useId();
  const query = value.trim().toLowerCase();
  const selected = destinations.find(row => row.id === selectedId) || null;
  const browsing = !query || (selected && value === selected.caption);
  const matched = browsing
    ? destinations
    : destinations.filter(row => (
      row.caption.toLowerCase().includes(query) || row.address.toLowerCase().includes(query)
    ));
  const hasRows = matched.length > 0;
  const emptyLabel = destinations.length ? 'No matches' : 'No other wallets yet';
  // Typed @handle / .sol values stay in the input. The menu is only for wallets.
  const shown = open && (hasRows || browsing);
  const options = hasRows
    ? matched
    : [{ id: 'empty', caption: emptyLabel, disabled: true }];

  useEffect(() => {
    setActive(0);
  }, [value, open]);

  useEffect(() => {
    if (!shown) return undefined;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [shown]);

  function choose(index) {
    const row = options[index];
    if (!row || row.disabled || row.spendable === false) return;
    setOpen(false);
    onPick?.(row);
    onChange?.(row.caption);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' && !shown) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!shown) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(current => (current + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      if (!hasRows) {
        setOpen(false);
        return;
      }
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="glide-select send-to"
      data-open={shown ? '' : undefined}
    >
      <div className="glide-select__trigger">
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${id}-${active}` : undefined}
          aria-label="To"
          placeholder="@alex or name.sol"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            onPick?.(null);
            onChange?.(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="glide-select__chevron send-to__chevron"
          aria-label={shown ? 'Close wallets' : 'Open wallets'}
          tabIndex={-1}
          onClick={() => setOpen(current => !current)}
        >
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {shown ? (
        <div className="glide-select__menu" data-state="open" data-side="bottom" data-align="left">
          <div id={`${id}-list`} role="listbox" aria-label="Wallets" className="glide-select__list">
            {options.map((row, index) => {
              const locked = row.disabled || row.spendable === false;
              return (
                <button
                  key={row.id}
                  id={`${id}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  disabled={locked || undefined}
                  className="glide-select__option"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  <span className="glide-select__name">{row.caption}</span>
                  {row.frozen ? <span className="glide-select__tag">Frozen</span> : null}
                  {!row.frozen && row.spendable === false ? <span className="glide-select__tag">Read only</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
