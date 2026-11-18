'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './FileScroll.css';

const SPRING = 0.22;

/**
 * Scrolling file list with a highlight that glides to the row in view.
 */
export default function FileScroll({
  items = [],
  onItemSelect,
  renderItem,
  selectOnScroll = true,
  radius = 6,
  gap = 2,
  className = '',
}) {
  const viewportRef = useRef(null);
  const itemRefs = useRef([]);
  const keyboardRef = useRef(false);
  const [selected, setSelected] = useState(items.length ? 0 : -1);
  const [box, setBox] = useState(null);
  const baseId = useId();

  useEffect(() => {
    setSelected(current => {
      if (items.length === 0) return -1;
      if (current < 0 || current >= items.length) return 0;
      return current;
    });
  }, [items.length]);

  useLayoutEffect(() => {
    const item = itemRefs.current[selected];
    const viewport = viewportRef.current;
    if (!item || !viewport) {
      setBox(null);
      return;
    }
    setBox({ top: item.offsetTop, height: item.offsetHeight });
    if (!keyboardRef.current) return;
    keyboardRef.current = false;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < viewport.scrollTop) viewport.scrollTo({ top, behavior: 'smooth' });
    else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTo({ top: bottom - viewport.clientHeight, behavior: 'smooth' });
    }
  }, [selected, items.length]);

  function nearest(viewport) {
    const mid = viewport.scrollTop + viewport.clientHeight / 2;
    let best = 0;
    let distance = Infinity;
    itemRefs.current.forEach((item, index) => {
      if (!item) return;
      const center = item.offsetTop + item.offsetHeight / 2;
      const next = Math.abs(center - mid);
      if (next < distance) {
        distance = next;
        best = index;
      }
    });
    return best;
  }

  function onScroll() {
    const viewport = viewportRef.current;
    if (!viewport || !selectOnScroll || keyboardRef.current || items.length === 0) return;
    const index = nearest(viewport);
    setSelected(current => (current === index ? current : index));
  }

  function onKeyDown(event) {
    if (!items.length) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.key === 'Enter') {
      if (selected >= 0) onItemSelect?.(items[selected], selected);
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : -1;
    keyboardRef.current = true;
    setSelected(current => {
      const start = current < 0 ? 0 : current;
      return Math.min(items.length - 1, Math.max(0, start + step));
    });
  }

  return (
    <div
      className={`file-rows${className ? ` ${className}` : ''}`}
      style={{
        '--al-radius': `${radius}px`,
        '--al-gap': `${gap}px`,
        '--al-width': '100%',
        '--al-ink': '#f5f5f5',
        '--al-muted': '#a3a3a3',
        '--al-well': '#2a2a2a',
        '--al-ring-fill': '#242424',
        '--al-glide': `${SPRING}s`,
      }}
    >
      <div
        ref={viewportRef}
        className="file-rows__viewport"
        role="listbox"
        tabIndex={0}
        aria-label="Files"
        aria-activedescendant={selected >= 0 ? `${baseId}-${selected}` : undefined}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        <div className="file-rows__track">
          <div
            className="file-rows__indicator"
            style={box ? {
              opacity: 1,
              transform: `translate3d(0, ${box.top}px, 0)`,
              height: box.height,
              transition: `transform var(--al-glide) ease, height var(--al-glide) ease`,
            } : undefined}
          >
            <div className="file-rows__ring" />
          </div>
          {items.map((item, index) => (
            <button
              key={item.id ?? index}
              id={`${baseId}-${index}`}
              ref={element => { itemRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={index === selected}
              data-selected={index === selected ? '' : undefined}
              className="file-rows__item"
              onPointerEnter={() => setSelected(index)}
              onClick={() => {
                setSelected(index);
                onItemSelect?.(item, index);
              }}
            >
              {renderItem ? renderItem(item, index, index === selected) : (
                <span className="file-rows__title">{item.title}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
