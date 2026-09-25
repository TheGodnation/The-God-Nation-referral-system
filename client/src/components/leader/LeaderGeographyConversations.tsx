import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { GeographyConversation } from '../GeographyConversation';

interface RoleAssignmentItem {
  id: string;
  community: { id: string; name: string } | null;
  geography: { id: string; name: string; type: string } | null;
}

// Phase 3M.6 — renders the shared GeographyConversation panel once for
// every Geography the Leader currently holds an ACTIVE SCOPED_LEADER
// RoleAssignment for. Exact match only, mirroring
// LeaderCommunityConversations.tsx's own precedent: a Leader scoped to a
// descendant or ancestor Geography does not get a panel for this exact
// node merely by proximity — the server independently re-verifies exact
// access on every request, this component's own filtering is only what
// decides which panels to render, never an authorization decision.
// Community-scoped roles are not shown here — that's
// LeaderCommunityConversations' own concern.
export function LeaderGeographyConversations() {
  const [geographies, setGeographies] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api
      .get<{ items: RoleAssignmentItem[] }>('/api/leader/role-assignments')
      .then((res) => {
        setGeographies(
          res.items
            .filter((r): r is RoleAssignmentItem & { geography: { id: string; name: string; type: string } } =>
              Boolean(r.geography),
            )
            .map((r) => r.geography),
        );
      })
      .catch(() => setGeographies([]));
  }, []);

  return (
    <>
      {geographies.map((g) => (
        <GeographyConversation key={g.id} geographyId={g.id} geographyName={g.name} />
      ))}
    </>
  );
}
