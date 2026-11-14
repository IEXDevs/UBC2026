'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DOCK_EXPAND_MS, dockCollapseDelay, dockShouldStayOpen } from '../lib/dock-hold.mjs';
import GlassSurface from './GlassSurface';
import GooeyNav from './GooeyNav';

function centered(panes, active) {
  const count = panes.length;
  const at = Math.max(0, panes.indexOf(active));
  const mid = Math.floor(count / 2);
  return Array.from({ length: count }, (_, slot) => panes[(at + slot - mid + count) % count]);
}

export default function PaneDock({ panes, pane, onChange }) {
  const mid = Math.floor(panes.length / 2);
  const [order, setOrder] = useState(() => centered(panes, pane));
  const [open, setOpen] = useState(false);
  const [pill, setPill] = useState(mid);
  const [box, setBox] = useState({ width: 148, height: 48 });
  const wait = useRef(null);
  const settle = useRef(null);
  const hold = useRef(false);
  const closed = useRef(true);
  const expanded = useRef(false);
  const openedAt = useRef(0);
  const wasOpen = useRef(false);
  const openState = useRef(false);
  const rootRef = useRef(null);
  const measureRef = useRef(null);
  const pointer = useRef({ x: -1, y: -1, forced: false });
  const syncRef = useRef(() => {});
  const paneRef = useRef(pane);
  paneRef.current = pane;
  openState.current = open;

  useEffect(() => {
    const stayedClosed = !open && !wasOpen.current;
    wasOpen.current = open;
    if (!stayedClosed) return undefined;
    setOrder(centered(panes, pane));
    setPill(mid);
    return undefined;
  }, [pane, panes, open, mid]);

  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return undefined;
    const read = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(1, Math.ceil(rect.width));
      const height = Math.max(1, Math.ceil(rect.height));
      setBox(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    clearTimeout(wait.current);
    clearTimeout(settle.current);
  }, []);

  useEffect(() => {
    function track(event) {
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
      if (expanded.current || openState.current) syncRef.current();
    }
    window.addEventListener('pointermove', track, { passive: true });
    return () => window.removeEventListener('pointermove', track);
  }, []);

  const items = useMemo(() => order.map(name => ({ label: name })), [order]);

  function expandMs() {
    const raw = rootRef.current ? getComputedStyle(rootRef.current).getPropertyValue('--dock-expand') : '';
    const ms = Number.parseFloat(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : DOCK_EXPAND_MS;
  }

  function containsPointer() {
    if (pointer.current.forced) return true;
    const node = rootRef.current;
    if (!node || pointer.current.x < 0) return false;
    const rect = node.getBoundingClientRect();
    const pad = 12;
    const { x, y } = pointer.current;
    return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
  }

  function collapse() {
    expanded.current = false;
    openedAt.current = 0;
    closed.current = false;
    hold.current = false;
    setOpen(false);
    clearTimeout(wait.current);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      closed.current = true;
      setOrder(centered(panes, paneRef.current));
      setPill(mid);
    }, expandMs() + 40);
  }

  function sync() {
    const inside = containsPointer();
    const duration = expandMs();
    const elapsed = expanded.current ? performance.now() - openedAt.current : duration;
    const stay = expanded.current && dockShouldStayOpen(inside, elapsed, duration);
    if (inside || stay) {
      clearTimeout(wait.current);
      hold.current = true;
      if (!expanded.current) {
        if (closed.current) {
          setOrder(centered(panes, paneRef.current));
          setPill(mid);
        }
        openedAt.current = performance.now();
        expanded.current = true;
      }
      if (!openState.current) setOpen(true);
      if (!inside) {
        wait.current = setTimeout(() => syncRef.current(), dockCollapseDelay(performance.now(), openedAt.current, duration));
      }
      return;
    }
    if (expanded.current || openState.current) collapse();
  }

  syncRef.current = sync;

  function pointFrom(event) {
    if (event?.clientX == null) return;
    pointer.current.x = event.clientX;
    pointer.current.y = event.clientY;
  }

  function enter(event) {
    pointFrom(event);
    pointer.current.forced = true;
    sync();
    pointer.current.forced = false;
  }

  function leave(event) {
    pointFrom(event);
    sync();
  }

  function pick(index, item) {
    if (!open || !item || item.label === pane) return;
    setPill(index);
    onChange(item.label, index >= mid ? 'right' : 'left');
  }

  return (
    <div
      ref={rootRef}
      className={`dock-slot${open ? ' is-open' : ''}`}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={event => {
        if (!open && event.target !== event.currentTarget) enter();
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) leave();
      }}
    >
      <GlassSurface
        width={box.width}
        height={box.height}
        borderRadius={999}
        borderWidth={0.08}
        brightness={62}
        opacity={0.93}
        blur={14}
        backgroundOpacity={0.36}
        saturation={1.5}
        distortionScale={-70}
        redOffset={0}
        greenOffset={8}
        blueOffset={16}
        className="pane-glass"
      >
        <div ref={measureRef} className="dock-measure">
          <GooeyNav
            key={order.join('|')}
            className="pane-nav"
            frame={false}
            items={items}
            activeIndex={pill}
            theme="dark"
            size="md"
            particleCount={15}
            spread={56}
            animationTime={600}
            timeVariance={300}
            gooeyness={0.5}
            wobble={0.5}
            hoverEffect
            onChange={pick}
          />
        </div>
      </GlassSurface>
    </div>
  );
}
