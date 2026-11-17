/**
 * Live tool events as chips and a branch tree.
 * Seeded demo timelines stay out of this model; callers pass runtime events only.
 */

const KIND = Object.freeze({
  'tool.call': 'Tool',
  'trust.gate': 'Trust',
  'verify.attempt': 'Verify',
  'verify.settled': 'Verify',
  'verify.mismatch': 'Mismatch',
  'approval.requested': 'Approval',
  'approval.granted': 'Approval',
  'approval.consumed': 'Approval',
  'payment.x402': 'x402',
  'tx.submitted': 'Transaction',
  'tx.confirmed': 'Transaction',
});

const CHIP_KINDS = new Set(['tool.call', 'payment.x402', 'tx.submitted', 'tx.confirmed']);

export function clipTrace(text, max = 72) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 1))}…`;
}

export function callStatus(kind) {
  if (kind === 'verify.mismatch') return 'error';
  if (kind === 'approval.requested' || kind === 'tx.submitted' || kind === 'verify.attempt') return 'running';
  return 'done';
}

export function traceModel(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const chips = [];
  const sections = [];
  for (const entry of list) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.summary !== 'string') continue;
    const label = KIND[entry.kind] ?? entry.kind ?? 'Event';
    if (CHIP_KINDS.has(entry.kind)) {
      chips.push({
        id: entry.id,
        name: label,
        argument: clipTrace(entry.summary, 42),
        status: callStatus(entry.kind),
        icon: 'terminal',
      });
    }
    let group = sections.find(item => item.value === label);
    if (!group) {
      group = { value: label, label, children: [] };
      sections.push(group);
    }
    group.children.push({ value: entry.id, label: clipTrace(entry.summary, 64) });
  }
  return { chips, sections };
}

const GENERIC_PURPOSE = /^(browse|browsing|search|browser|live browser session)$/i;

function purposeLabel(purpose) {
  const text = clipTrace(purpose || '', 64);
  if (!text || GENERIC_PURPOSE.test(text)) return '';
  return text;
}

/** One line for open browser sessions. Default purposes like "browse" stay out of the log. */
export function browserTrace(sessions) {
  const open = (Array.isArray(sessions) ? sessions : []).filter(row => (
    row
    && row.status === 'open'
    && typeof row.sessionRecordId === 'string'
    && row.sessionRecordId.length > 0
  ));
  if (open.length === 0) return { chips: [], section: null };
  const purpose = purposeLabel(open.find(row => purposeLabel(row.purpose))?.purpose);
  return {
    chips: [{
      id: 'browser-open',
      name: 'Browser',
      argument: purpose || (open.length === 1 ? 'Open' : `${open.length} open`),
      status: 'running',
      icon: 'terminal',
    }],
    section: null,
  };
}
