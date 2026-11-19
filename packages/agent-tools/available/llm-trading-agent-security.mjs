export default Object.freeze({
  "id": "llm-trading-agent-security",
  "command": "/llm-trading-agent-security",
  "title": "Trading agent security",
  "group": "Agent intelligence",
  "source": "available",
  "needsConnector": null,
  "description": "Check a trading agent against the spend rules.",
  "order": 13,
  "instruction": "Skill /llm-trading-agent-security. Group: Agent intelligence.\nThe owner text is the trading flow to check.\nA spend is allowed only in this order: trust, verify, wallet freeze, bot policy, approval mode, then sign.\nExecution is Solana devnet. A mainnet price is paper. A quote is not a transaction.\nRefuse a path that skips a step, signs from model output, or puts a key, seed, or live view URL in the reply.\nDo not spend."
});
