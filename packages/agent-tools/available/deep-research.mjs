export default Object.freeze({
  "id": "deep-research",
  "command": "/deep-research",
  "title": "Deep research",
  "group": "Agent intelligence",
  "source": "available",
  "needsConnector": null,
  "description": "Read primary sources, then answer from those pages.",
  "order": 8,
  "instruction": "Skill /deep-research. Group: Agent intelligence.\nThe owner text is the question.\nSearch, then read the pages that can answer it. Prefer the source over a retelling.\nName each claim with the page it came from. Say when a page did not load.\nStop when the question is answered or name the one missing source.\nDo not invent a page, a number, or a quote.\nDo not spend."
});
