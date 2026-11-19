export default Object.freeze({
  "id": "research-ops",
  "command": "/research-ops",
  "title": "Research ops",
  "group": "Agent intelligence",
  "source": "available",
  "needsConnector": null,
  "description": "Keep a running list of what is known and what is still open.",
  "order": 9,
  "instruction": "Skill /research-ops. Group: Agent intelligence.\nThe owner text is the research job.\nSplit it into questions. For each one, record the source, the finding, and whether it is still open.\nHand a single question to a subagent when it needs its own lookup, then read that result before you answer.\nEnd with the open questions only. Do not restart work that is already recorded.\nDo not spend."
});
