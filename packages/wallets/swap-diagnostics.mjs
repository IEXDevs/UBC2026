const PROGRAM_ID = '[1-9A-HJ-NP-Za-km-z]{32,44}';
const ADDRESS = new RegExp(`^${PROGRAM_ID}$`);
const PROGRAM_FAILURE = new RegExp(`^Program ${PROGRAM_ID} failed: (?:custom program error: 0x[0-9a-fA-F]{1,8}|invalid account data for instruction|insufficient funds for instruction|incorrect program id for instruction|missing required signature|invalid instruction data|invalid program argument|computational budget exceeded)$`);
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_INSUFFICIENT_SOL = 'Program 11111111111111111111111111111111 failed: custom program error: 0x1';
const LAMPORT_SHORTFALL = /^(?:Program log: )?Transfer: insufficient lamports [0-9]{1,20}, need [0-9]{1,20}$/;
const SOLANA_LOGS = new Set([
  'Program log: Error: insufficient funds',
  'Log truncated',
]);

export function swapSetupNeedsSol(details) {
  return details?.instructionProgram === ATA_PROGRAM && details.logs.includes(SYSTEM_INSUFFICIENT_SOL);
}

export function swapSimulationDetails(details) {
  const instructionProgram = typeof details?.instructionProgram === 'string' && ADDRESS.test(details.instructionProgram)
    ? details.instructionProgram : null;
  // Program logs can contain arbitrary data. Only pass known messages and runtime failure records.
  const recent = Array.isArray(details?.logs) ? details.logs.slice(-64) : [];
  const setupNeedsSol = swapSetupNeedsSol({ instructionProgram, logs: recent });
  const logs = recent.filter(line => typeof line === 'string' && line.length <= 128
    && (PROGRAM_FAILURE.test(line) || SOLANA_LOGS.has(line) || (setupNeedsSol && LAMPORT_SHORTFALL.test(line)))).slice(-6);
  return instructionProgram || logs.length ? { instructionProgram, logs } : null;
}
