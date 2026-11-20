export async function logoutAfterFlush(flush, logout, timeoutMs = 2500) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(flush),
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } catch {
    // A failed desk save must not prevent sign-out.
  } finally {
    clearTimeout(timer);
  }
  return logout();
}
