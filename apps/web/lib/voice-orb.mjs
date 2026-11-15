/** One Thinking Orb look for chat work and for a voice call. */

export function voiceOrbLook(side) {
  if (side === 'agent') return { state: 'reasoning', variant: 'default', label: 'Agent speaking' };
  if (side === 'user') return { state: 'using', variant: 'record', label: 'You speaking' };
  return { state: 'idle', variant: 'blink', label: 'On the call' };
}

export function chatOrbLook(kind) {
  if (kind === 'search') return { state: 'searching', variant: 'default', label: 'Searching' };
  if (kind === 'browser') return { state: 'using', variant: 'default', label: 'Using the browser' };
  if (kind === 'tool') return { state: 'working', variant: 'default', label: 'Working' };
  return { state: 'reasoning', variant: 'default', label: 'Thinking' };
}

export function orbSpeed(level) {
  const amount = Math.max(0, Math.min(1, Number(level) || 0));
  return Math.round((0.75 + amount * 1.5) * 100) / 100;
}
