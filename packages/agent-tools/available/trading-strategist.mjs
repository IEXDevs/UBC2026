
import { EXECUTION_LABEL } from '@ubc2026/contracts/solana';
export default Object.freeze({
  "id": "trading-strategist",
  "command": "/trading-strategist",
  "title": "Trading strategist",
  "group": "Crypto",
  "source": "available",
  "needsConnector": null,
  "description": "State a paper plan. A quote is not an order.",
  "order": 24,
  "instruction": `Skill /trading-strategist. Group: Crypto.\nThe owner text is the market decision they want talked through.\nState the asset, the condition, and what would cancel it.\nA price is paper: ${EXECUTION_LABEL}. A quote never authorizes a transaction.\nIf a spend is actually requested, leave it on the permissioned tools. Do not sign and do not broadcast.\nDo not invent a fill.`
});
