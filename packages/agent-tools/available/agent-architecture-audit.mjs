export default Object.freeze({
  "id": "agent-architecture-audit",
  "command": "/agent-architecture-audit",
  "title": "Agent architecture audit",
  "group": "Agent intelligence",
  "source": "available",
  "needsConnector": null,
  "description": "Audit how an agent is wired before trusting it with work.",
  "order": 12,
  "instruction": "Skill /agent-architecture-audit. Group: Agent intelligence.\nThe owner text is the agent or flow to audit.\nLook at who it can hand work to, which tools it can call, which apps are connected, and which permission mode is on.\nName a gap only when you can point at the missing check.\nDo not propose a second payment path. Spend stays on the permissioned tools.\nDo not spend."
});
