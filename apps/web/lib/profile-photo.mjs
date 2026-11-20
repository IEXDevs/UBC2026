// Account appearance already follows the owner through the `looks` state row.
// This reserved key cannot collide with an agent id (bot_* or UUID).
export const PROFILE_LOOK_KEY = '$profile';

export function profilePhoto(looks) {
  const image = looks?.[PROFILE_LOOK_KEY]?.image;
  return typeof image === 'string' && image.length <= 32768
    && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image) ? image : '';
}

export function withProfilePhoto(looks, image) {
  if (!profilePhoto({ [PROFILE_LOOK_KEY]: { image } })) return null;
  return { ...looks, [PROFILE_LOOK_KEY]: { image } };
}
