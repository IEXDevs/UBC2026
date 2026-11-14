'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const hold = useRef(false);
  const closed = useRef(true);
  const wasOpen = useRef(false);
  const measureRef = useRef(null);
  const paneRef = useRef(pane);
  paneRef.current = pane;

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

  useEffect(() => () => clearTimeout(wait.current), []);

  const items = useMemo(() => order.map(name => ({ label: name })), [order]);

  function enter() {
    clearTimeout(wait.current);
    hold.current = true;
    if (!open && closed.current) {
      setOrder(centered(panes, paneRef.current));
      setPill(mid);
    }
    requestAnimationFrame(() => {
      if (hold.current) setOpen(true);
    });
  }

  function leave() {
    hold.current = false;
    closed.current = false;
    setOpen(false);
    clearTimeout(wait.current);
    wait.current = setTimeout(() => {
      closed.current = true;
      setOrder(centered(panes, paneRef.current));
      setPill(mid);
    }, 560);
  }

  function pick(index, item) {
    if (!open || !item || item.label === pane) return;
    setPill(index);
    onChange(item.label, index >= mid ? 'right' : 'left');
  }

  return (
    <div
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
