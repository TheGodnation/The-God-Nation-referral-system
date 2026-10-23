// After signing in: when the server says the member's "Delete my account"
// was cancelled by this sign-in, the app greets them once ("Welcome back —
// your account was not deleted"); see WelcomeBackBanner.

const KEY = 'account:welcome-back';

export function noteSignIn(response: unknown) {
  try {
    if ((response as { deletionCancelled?: boolean } | null)?.deletionCancelled) sessionStorage.setItem(KEY, '1');
  } catch {
    // Not shown; nothing else depends on it.
  }
}

export function takeWelcomeBack(): boolean {
  try {
    const yes = sessionStorage.getItem(KEY) === '1';
    sessionStorage.removeItem(KEY);
    return yes;
  } catch {
    return false;
  }
}
