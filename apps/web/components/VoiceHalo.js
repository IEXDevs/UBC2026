'use client';

import CometDial from './CometDial';
import './WakeSlider.css';

const BARS = 32;

export default function VoiceHalo({ level = 0, color = '#f5f5f5', size = 340, children }) {
  const amount = Math.max(0, Math.min(1, Number(level) || 0));
  const lit = amount * (BARS - 1);

  return (
    <div className="voice-halo" style={{ width: size, height: size, '--ws-fill': color, '--ws-track': '#27272a' }}>
      <CometDial
        value={Math.round(amount * 100)}
        min={0}
        max={100}
        unit=""
        label="Agent voice"
        size={size}
        sweep={320}
        thickness={6}
        disabled
        accent={color}
        ink="#f5f5f5"
        className="voice-halo-dial"
      />
      <div className="wake-ring" aria-hidden="true">
        {Array.from({ length: BARS }, (_, index) => {
          const distance = index - lit;
          const reach = 3.2;
          const lift = Math.abs(distance) < reach ? Math.cos((Math.PI * distance) / (2 * reach)) ** 2 : 0;
          const on = index <= Math.round(lit);
          const scale = 0.28 + (on ? 0.42 : 0) + lift * 0.75;
          const angle = -200 + (index / (BARS - 1)) * 320;
          return (
            <span
              key={index}
              className="wake-slider__bar"
              data-on={on ? 'true' : 'false'}
              style={{ transform: `rotate(${angle}deg) translateY(-128px) scaleY(${scale})` }}
            />
          );
        })}
      </div>
      <div className="voice-halo-agent">{children}</div>
    </div>
  );
}
