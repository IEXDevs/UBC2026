export default Object.freeze({
  "id": "tdd",
  "command": "/tdd",
  "title": "TDD",
  "group": "AIHero / engineering",
  "source": "available",
  "needsConnector": null,
  "description": "Write the failing check, then the smallest change that passes.",
  "order": 6,
  "instruction": "Skill /tdd. Group: AIHero / engineering.\nThe owner text is the behavior to add or fix.\nName the public seam first. Write one failing check at that seam, then the smallest change that makes it pass.\nDo not test a private helper. Do not write the whole suite before any change.\nThe expected value comes from the spec, not from redoing the implementation in the assertion.\nDo not spend."
});
