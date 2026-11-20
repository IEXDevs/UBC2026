const PROGRAM_ID = '[1-9A-HJ-NP-Za-km-z]{32,44}';
const ADDRESS = new RegExp(`^${PROGRAM_ID}$`);
const PROGRAM_FAILURE = new RegExp(`^Program ${PROGRAM_ID} failed: (?:custom program error: 0x[0-9a-fA-F]{1,8}|invalid account data for instruction|insufficient funds for instruction|incorrect program id for instruction|missing required signature|invalid instruction data|invalid program argument|computational budget exceeded)$`);
const SOLANA_LOGS = new Set([
  'Program log: Error: insufficient funds',
  'Log truncated',
]);

export function swapSimulationDetails(details) {
  const instructionProgram = typeof details?.instructionProgram === 'string' && ADDRESS.test(details.instructionProgram)
    ? details.instructionProgram : null;
  // Program logs can contain arbitrary data. Only pass known messages and runtime failure records.
  const logs = Array.isArray(details?.logs) ? details.logs.slice(-64).filter(line => typeof line === 'string'
    && line.length <= 128 && (PROGRAM_FAILURE.test(line) || SOLANA_LOGS.has(line))).slice(-6) : [];
  return instructionProgram || logs.length ? { instructionProgram, logs } : null;
}
