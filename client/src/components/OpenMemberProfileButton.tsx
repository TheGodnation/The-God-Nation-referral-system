import { useState } from 'react';
import { api } from '../lib/api';

// "View my member profile" for a leader or the central admin who is signed in to
// their dashboard: opens the member side with no second sign-in, and keeps the
// dashboard session. If there is no member profile to open, or it cannot be
// opened, they are sent to the member sign-in page as before.
export function OpenMemberProfileButton({ endpoint, className, children }: { endpoint: string; className?: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(endpoint, {});
      // A full page load, so the member side starts with its new sign-in.
      window.location.assign('/member/me');
    } catch {
      window.location.assign('/member/login');
    }
  }

  return (
    <button type="button" className={className} onClick={() => void open()} disabled={busy}>
      {children}
    </button>
  );
}
