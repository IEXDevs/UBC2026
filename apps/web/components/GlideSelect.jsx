'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { glideRowAt } from '../lib/glide-select.mjs';

import './GlideSelect.css';

const SIZES = {
  sm: { chip: 28, row: 26, font: 12 },
  md: { chip: 32, row: 30, font: 13 },
  lg: { chip: 44, row: 40, font: 14 },
};
const PAD = 4;
const GAP = 1;
const MENU_GAP = 6;

const norm = (option) => (typeof option === 'string' ? { value: option, label: option } : option);
const textOf = (item) => (typeof item.label === 'string' ? item.label : item.value);
const typeaheadIndex = (items, from, ch) => {
  const letter = ch.toLowerCase();
  const count = items.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (from + step) % count;
    if (!items[index].disabled && textOf(items[index]).toLowerCase().startsWith(letter)) return index;
  }
  return from;
};

export default function GlideSelect({
  options = [],
  value,
  defaultValue,
  onChange,
  placeholder = 'Select…',
  showTags = true,
  accentColor = '#f5f5f5',
  surfaceColor = '#27272a',
  highlightColor = '#3f3f46',
  textColor = '#f5f5f5',
  size = 'md',
  radius = 10,
  menuWidth = 176,
  placement = 'bottom',
  align = 'left',
  popDuration = 180,
  glideDuration = 220,
  rememberPosition = true,
  disabled = false,
  ariaLabel = 'Select',
  className = '',
  menuAction = null,
  closeSignal = 0,
  onOpenChange = null,
}) {
  const items = options.map(norm);
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const selected = items.findIndex((item) => item.value === current);
  const [phase, setPhase] = useState('closed');
  const [active, setActive] = useState(null);
  const [side, setSide] = useState(placement);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const pillRef = useRef(null);
  const instant = useRef(false);
  const closeTimer = useRef(undefined);
  const scrub = useRef(null);
  const id = useId();
  const metrics = SIZES[size] ?? SIZES.md;
  const step = metrics.row + GAP;
  const popOut = Math.round((popDuration * 2) / 3);

  useLayoutEffect(() => {
    if (phase !== 'open') return;
    const menu = menuRef.current;
    const root = rootRef.current;
    if (!menu || !root) return;
    const rect = root.getBoundingClientRect();
    const need = menu.offsetHeight + MENU_GAP;
    setSide(
      placement === 'bottom' && rect.bottom + need > window.innerHeight
        ? 'top'
        : placement === 'top' && rect.top - need < 0
          ? 'bottom'
          : placement,
    );
    menu.style.transitionDuration = instant.current ? '0ms' : '';
    menu.dataset.state = 'closed';
    void menu.offsetHeight;
    menu.dataset.state = 'open';
    const pill = pillRef.current;
    if (pill) {
      pill.style.transition = 'none';
      pill.style.transform = `translateY(${Math.max(0, selected) * step}px)`;
      pill.style.opacity = '0';
      void pill.offsetHeight;
      pill.style.transition = '';
    }
  }, [phase, placement, selected, step]);

  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill || phase !== 'open') return;
    if (active === null) {
      pill.style.opacity = '0';
      return;
    }
    const jump = instant.current || pill.style.opacity !== '1';
    pill.style.transitionDuration = jump ? '0ms, 150ms' : '';
    pill.style.transform = `translateY(${active * step}px)`;
    pill.style.opacity = '1';
    instant.current = false;
  }, [active, phase, step]);

  const open = (viaKey) => {
    if (disabled) return;
    clearTimeout(closeTimer.current);
    instant.current = true;
    setActive(selected >= 0 ? selected : viaKey ? 0 : null);
    setPhase('open');
    onOpenChange?.(true);
  };
  const close = (mode) => {
    setActive(null);
    clearTimeout(closeTimer.current);
    const menu = menuRef.current;
    if (mode === 'instant' || !menu) {
      setPhase('closed');
      onOpenChange?.(false);
      return;
    }
    menu.style.transitionDuration = '';
    menu.dataset.state = 'closed';
    setPhase('closing');
    onOpenChange?.(false);
    closeTimer.current = setTimeout(() => setPhase('closed'), popOut + 20);
  };
  const pick = (index, viaKey) => {
    const item = items[index];
    if (!item || item.disabled) {
      close('instant');
      return;
    }
    if (item.value !== current) {
      if (value === undefined) setInner(item.value);
      onChange?.(item.value, item);
      if (!viaKey && rootRef.current) rootRef.current.dataset.swap = '';
    }
    close('instant');
    triggerRef.current?.focus({ preventScroll: true });
  };

  const onTriggerKey = (event) => {
    const key = event.key;
    const count = items.length;
    const cursor = active ?? Math.max(0, selected);
    if (phase !== 'open') {
      if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        open(true);
      }
      return;
    }
    const go = (index) => {
      event.preventDefault();
      instant.current = true;
      setActive(Math.min(count - 1, Math.max(0, index)));
    };
    if (key === 'ArrowDown' || key === 'ArrowUp') go(active === null ? cursor : cursor + (key === 'ArrowDown' ? 1 : -1));
    else if (key === 'Home' || key === 'End') go(key === 'Home' ? 0 : count - 1);
    else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      pick(cursor, true);
    } else if (key === 'Escape' || key === 'Tab') {
      if (key === 'Escape') event.preventDefault();
      close('instant');
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      go(typeaheadIndex(items, cursor, key));
    }
  };

  useEffect(() => {
    if (phase === 'closed') return undefined;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) close('pop');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [phase, popOut]);

  useEffect(() => {
    if (disabled && phase !== 'closed') close('instant');
  }, [disabled, phase]);

  useEffect(() => {
    if (!closeSignal) return;
    setActive(null);
    setPhase('closed');
  }, [closeSignal]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const rowAt = (event) => {
    const drag = scrub.current;
    if (!drag) return null;
    const { top, bottom, left, right } = drag.list.getBoundingClientRect();
    return glideRowAt({ x: event.clientX, y: event.clientY }, {
      top, bottom, left, right, scrollTop: drag.list.scrollTop, step, count: items.length,
    });
  };
  const onListDown = (event) => {
    if (scrub.current) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is optional */
    }
    scrub.current = { id: event.pointerId, list: event.currentTarget };
    instant.current = true;
    setActive(rowAt(event));
  };
  const onListMove = (event) => {
    if (!scrub.current || scrub.current.id !== event.pointerId) return;
    const index = rowAt(event);
    if (index !== active) setActive(index);
  };
  const onListUp = (event) => {
    if (!scrub.current || scrub.current.id !== event.pointerId) return;
    const index = event.type === 'pointerup' ? rowAt(event) : null;
    scrub.current = null;
    if (index !== null) pick(index, false);
    else if (!rememberPosition) setActive(null);
  };
  const onListOver = (event) => {
    if (event.pointerType === 'touch' || scrub.current) return;
    const row = event.target.closest('[data-index]');
    if (!row) return;
    const index = Number(row.dataset.index);
    if (index !== active) setActive(index);
  };

  const origin = `${side === 'bottom' ? 'top' : 'bottom'} ${align}`;
  return (
    <div
      ref={rootRef}
      className={`glide-select${className ? ` ${className}` : ''}`}
      data-size={size}
      data-disabled={disabled ? '' : undefined}
      style={{
        '--gs-accent': accentColor,
        '--gs-surface': surfaceColor,
        '--gs-highlight': highlightColor,
        '--gs-text': textColor,
        '--gs-radius': `${radius}px`,
        '--gs-inner-radius': `${Math.max(3, radius - 4)}px`,
        '--gs-chip': `${metrics.chip}px`,
        '--gs-row': `${metrics.row}px`,
        '--gs-font': `${metrics.font}px`,
        '--gs-menu-w': `${menuWidth}px`,
        '--gs-pop': `${popDuration}ms`,
        '--gs-pop-out': `${popOut}ms`,
        '--gs-glide': `${glideDuration}ms`,
        '--gs-origin': origin,
      }}
      onAnimationEnd={(event) => {
        if (event.animationName === 'gs-swap' && rootRef.current) delete rootRef.current.dataset.swap;
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={phase === 'open'}
        aria-controls={`${id}-list`}
        aria-activedescendant={active !== null ? `${id}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className="glide-select__trigger"
        onPointerDown={(event) => {
          if (event.button !== 0 || disabled) return;
          event.currentTarget.focus({ preventScroll: true });
          if (phase === 'open') close('pop');
          else open(false);
        }}
        onKeyDown={onTriggerKey}
      >
        <span className="glide-select__label" key={current} data-empty={selected < 0 ? '' : undefined}>
          {selected >= 0 ? items[selected].label : placeholder}
        </span>
        <span className="glide-select__chevron" aria-hidden="true">
          <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.5} />
        </span>
      </button>
      {phase !== 'closed' ? (
        <div ref={menuRef} className="glide-select__menu" data-state="open" data-side={side} data-align={align}>
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={ariaLabel}
            className="glide-select__list"
            data-live={active !== null ? '' : undefined}
            onPointerOver={onListOver}
            onPointerLeave={() => {
              if (!scrub.current && !rememberPosition) setActive(null);
            }}
            onPointerDown={onListDown}
            onPointerMove={onListMove}
            onPointerUp={onListUp}
            onPointerCancel={onListUp}
            onLostPointerCapture={onListUp}
          >
            <span ref={pillRef} className="glide-select__pill" aria-hidden="true" />
            {items.map((item, index) => (
              <div
                key={item.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === selected}
                aria-disabled={item.disabled || undefined}
                data-index={index}
                data-disabled={item.disabled ? '' : undefined}
                className="glide-select__option"
              >
                <span className="glide-select__name">{item.label}</span>
                {showTags && item.tag ? <span className="glide-select__tag">{item.tag}</span> : null}
                <span className="glide-select__check" data-on={index === selected ? '' : undefined} aria-hidden="true">
                  <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.5} />
                </span>
              </div>
            ))}
          </div>
          {menuAction ? (
            <button
              type="button"
              className="glide-select__action"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                close('instant');
                menuAction.onSelect?.();
              }}
            >
              <span className="glide-select__action-shade" aria-hidden="true" />
              <span className="glide-select__name">{menuAction.label}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
