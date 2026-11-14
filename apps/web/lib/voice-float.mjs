export const FLOAT_SIZE = 76;
export const FLOAT_STORAGE_KEY = 'maelstrom.voiceFloat';

export function clampFloat(x, y, bounds = {}) {
  const width = bounds.width ?? FLOAT_SIZE;
  const height = bounds.height ?? FLOAT_SIZE;
  const margin = 12;
  const maxX = Math.max(margin, (bounds.vw ?? 0) - width - margin);
  const maxY = Math.max(margin, (bounds.vh ?? 0) - height - margin);
  const nextX = Number.isFinite(Number(x)) ? Number(x) : margin;
  const nextY = Number.isFinite(Number(y)) ? Number(y) : margin;
  return {
    x: Math.min(Math.max(margin, nextX), maxX),
    y: Math.min(Math.max(margin, nextY), maxY),
  };
}

export function withHeads(lines) {
  return lines.map((line, index) => ({
    ...line,
    head: index === 0 || lines[index - 1].role !== line.role,
  }));
}
