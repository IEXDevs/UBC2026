export function passwordFeedback(password, confirmation, problem, normalizedPassword = password) {
  const matches = Boolean(confirmation) && normalizedPassword === confirmation;
  return {
    problem: password ? problem : '',
    confirmation: confirmation ? (matches ? 'Passwords match.' : 'Passwords do not match.') : '',
    matches,
    ready: Boolean(password && confirmation && !problem && matches),
  };
}
