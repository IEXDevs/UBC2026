export default Object.freeze({
  "id": "diagnosing-bugs",
  "command": "/diagnosing-bugs",
  "title": "Diagnosing bugs",
  "group": "AIHero / engineering",
  "source": "available",
  "needsConnector": null,
  "description": "Build a failing check, then find the cause.",
  "order": 5,
  "instruction": "Skill /diagnosing-bugs. Group: AIHero / engineering.\nThe owner text is the bug. Skip the guess.\nFirst make a check that fails on this bug and passes when it is gone.\nThen name one cause that the check supports, and the next check if it does not.\nRedact secrets, seeds, and live view URLs before you quote any output.\nDo not spend."
});
