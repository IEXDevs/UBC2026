export default Object.freeze({
  "id": "code-review",
  "command": "/code-review",
  "title": "Code review",
  "group": "AIHero / engineering",
  "source": "available",
  "needsConnector": null,
  "description": "Review a change against the spec and the repo's own rules.",
  "order": 4,
  "instruction": "Skill /code-review. Group: AIHero / engineering.\nThe owner text names the change. If no fixed point is given, ask which one.\nReview on two lines: does it match the spec, and does it match the rules already written for this repo.\nHand each line to a subagent when both are in play, then report them side by side.\nQuote the finding. Do not rewrite the change unless the owner asked for a fix.\nDo not spend."
});
