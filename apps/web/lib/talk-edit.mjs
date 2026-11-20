/**
 * Replace one user line and drop every reply after it.
 * The caller sends the new text with `prior` as the model history.
 */

export function reviseThread(lines, lineId, text) {
  const spoken = typeof text === 'string' ? text.trim() : '';
  if (!spoken || typeof lineId !== 'string' || !lineId) return null;
  const rows = Array.isArray(lines) ? lines : [];
  const index = rows.findIndex((line) => line && line.id === lineId && line.role === 'user');
  if (index < 0) return null;
  const edited = {
    ...rows[index],
    text: spoken,
    editToken: `${lineId}:${Date.now()}`,
  };
  if (spoken !== rows[index].text) delete edited.mentionAddress;
  return {
    prior: rows.slice(0, index),
    lines: [...rows.slice(0, index), edited],
  };
}
