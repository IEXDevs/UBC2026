export function smoothLevel(current, target, dt, attack = 40, release = 180) {
  const tau = target > current ? attack : release;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau));
  return Math.max(0, Math.min(1, next));
}

export function rmsLevel(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const value of samples) {
    const x = (value - 128) / 128;
    sum += x * x;
  }
  return Math.max(0, Math.min(1, Math.sqrt(sum / samples.length) * 4.2));
}

export function speakingSide(input, output, threshold = 0.08) {
  if (output >= threshold && output >= input) return 'agent';
  if (input >= threshold) return 'user';
  return 'idle';
}
