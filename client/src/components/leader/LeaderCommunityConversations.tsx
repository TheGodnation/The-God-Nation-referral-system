import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CommunityConversation } from '../CommunityConversation';

interface RoleAssignmentItem {
  id: string;
  community: { id: string; name: string } | null;
  geography: { id: string; name: string; type: string } | null;
}

// Phase 3M.1 — renders the shared CommunityConversation panel once for
// every Community the Leader currently holds an ACTIVE SCOPED_LEADER
// RoleAssignment for. Geography-scoped roles are not shown here: Phase
// 3M.1 has no geography conversation concept. The server independently
// re-verifies this Leader's access on every request — this component's own
// filtering is only what decides which panels to render, never an
// authorization decision.
export function LeaderCommunityConversations() {
  const [communities, setCommunities] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api
      .get<{ items: RoleAssignmentItem[] }>('/api/leader/role-assignments')
      .then((res) => {
        setCommunities(
          res.items.filter((r): r is RoleAssignmentItem & { community: { id: string; name: string } } => Boolean(r.community)).map((r) => r.community),
        );
      })
      .catch(() => setCommunities([]));
  }, []);

  return (
    <>
      {communities.map((c) => (
        <CommunityConversation key={c.id} communityId={c.id} communityName={c.name} />
      ))}
    </>
  );
}
