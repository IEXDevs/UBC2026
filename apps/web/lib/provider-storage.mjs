// Provider credentials must never follow a different signed-in account. Keep
// them browser-local (outside account mirroring), but namespace every setting
// by the owner from the authenticated shell. Unowned legacy keys are not adopted.
export function providerStorage(storage, ownerId) {
  const owner = typeof ownerId === 'string' ? ownerId.trim() : '';
  const keyFor = key => `${key}.${encodeURIComponent(owner)}`;
  return {
    getItem: key => (owner && storage ? storage.getItem(keyFor(key)) : null),
    setItem(key, value) {
      if (!owner || !storage) throw new Error('provider_owner_required');
      storage.setItem(keyFor(key), value);
    },
  };
}
