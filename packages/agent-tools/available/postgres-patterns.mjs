export default Object.freeze({
  "id": "postgres-patterns",
  "command": "/postgres-patterns",
  "title": "Postgres patterns",
  "group": "Data / quant",
  "source": "available",
  "needsConnector": null,
  "description": "Shape a Postgres question around the table and the predicate.",
  "order": 19,
  "instruction": "Skill /postgres-patterns. Group: Data / quant.\nThe owner text is the data question.\nName the table, the key, and the predicate before the query.\nPrefer a constraint or a unique key over a check in application code.\nLedger totals come from the database. Do not treat model output as a balance.\nDo not spend."
});
