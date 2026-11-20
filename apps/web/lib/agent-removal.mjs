/** Keep deleted agents out of stale lists and order DELETE after any in-flight save. */
export function createAgentRemoval(onChange) {
  const removed = new Map();
  const saves = new Map();

  function setRemoved(ownerId, botId, hidden) {
    const ids = new Set(removed.get(ownerId));
    if (hidden) ids.add(botId);
    else ids.delete(botId);
    if (ids.size) removed.set(ownerId, ids);
    else removed.delete(ownerId);
    onChange(new Map(removed));
  }

  function key(ownerId, botId) {
    return JSON.stringify([ownerId, botId]);
  }

  return {
    async save(ownerId, botId, saveRemote) {
      if (removed.get(ownerId)?.has(botId)) return { ok: false, error: 'agent_removed' };
      const id = key(ownerId, botId);
      const pending = saves.get(id);
      if (pending) return pending;
      const save = Promise.resolve().then(saveRemote).finally(() => saves.delete(id));
      saves.set(id, save);
      return save;
    },
    async remove(ownerId, botId, deleteRemote) {
      if (removed.get(ownerId)?.has(botId)) return null;
      setRemoved(ownerId, botId, true);
      await saves.get(key(ownerId, botId))?.catch(() => {});
      try {
        const result = await deleteRemote();
        if (result.ok) return result;
      } catch {
        // A failed delete restores the same card and local agent data.
      }
      setRemoved(ownerId, botId, false);
      return { ok: false };
    },
  };
}
