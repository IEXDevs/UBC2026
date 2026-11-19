export default Object.freeze({
  "id": "iterative-retrieval",
  "command": "/iterative-retrieval",
  "title": "Iterative retrieval",
  "group": "Agent intelligence",
  "source": "available",
  "needsConnector": null,
  "description": "Search, read, then search again with what the page taught you.",
  "order": 10,
  "instruction": "Skill /iterative-retrieval. Group: Agent intelligence.\nThe owner text is the thing to find.\nSearch once. Read the best page. If it does not answer, write a tighter query from what it said and search once more.\nKeep the queries and the pages in the reply.\nStop after the answer is on a page you read, or after two searches that still miss.\nDo not invent a page.\nDo not spend."
});
