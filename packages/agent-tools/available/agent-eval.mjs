export default Object.freeze({
  "id": "agent-eval",
  "command": "/agent-eval",
  "title": "Agent eval",
  "group": "Agent intelligence",
  "source": "available",
  "needsConnector": null,
  "description": "Score an agent turn against a check you can re-run.",
  "order": 11,
  "instruction": "Skill /agent-eval. Group: Agent intelligence.\nThe owner text is the agent behavior to score.\nWrite the check first: the input, the expected result, and how you would tell a miss.\nRun that check with the tools this agent has. Report pass or fail, and the evidence.\nDo not change the check after you see the result.\nDo not spend unless the check itself is an allowed spend."
});
