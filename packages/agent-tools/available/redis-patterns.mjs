export default Object.freeze({
  "id": "redis-patterns",
  "command": "/redis-patterns",
  "title": "Redis patterns",
  "group": "Data / quant",
  "source": "available",
  "needsConnector": null,
  "description": "Use Redis for a short-lived value, not the ledger.",
  "order": 20,
  "instruction": "Skill /redis-patterns. Group: Data / quant.\nThe owner text is the cache or lock question.\nSay the key, the value, and when it expires.\nA cache miss reads the database. A lock has an owner and a deadline.\nDo not store a balance, a seed, or a permission decision only in Redis.\nDo not spend."
});
