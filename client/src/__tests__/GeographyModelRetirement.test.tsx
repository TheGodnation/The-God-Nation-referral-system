import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PeopleTab } from '../components/admin/PeopleTab';

// Final Geography Retirement — the Geography model, GeographyTab.tsx, and
// every admin.geography.* i18n key are removed entirely. Most of this
// step's client checklist is already covered by dedicated files elsewhere
// and deliberately not duplicated here (per "do not overbuild tests"):
// - Geography Leader UI / Community Leader UI remain correctly split:
//   RoleAssignmentsTabGeographyRetirement.test.tsx (Step 5B).
// - Geography roster UI gone / Community roster remains:
//   MyMembers.test.tsx (Step 5B).
// - Member location UI remains editable/displayable:
//   MemberDashboardProfile.test.tsx (untouched by this step).
// - Existing Community functionality intact: the full client suite passing.
// This file covers what nothing else does: i18n key removal, and that
// PeopleTab (whose own Geographic Assignment card/column Step 5B removed)
// still renders its Community-based People list correctly with no trace of
// Geography.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const match = Object.keys(responses).find((key) => url.includes(key));
      const res = match ? responses[match] : { status: 404, body: { error: 'not found' } };
      return Promise.resolve({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: () => 'application/json' },
        json: async () => res.body,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Final Geography Retirement — i18n', () => {
  it('1-3, 7-8. every admin.geography.* key and admin.tabs.geography are gone from both English and French', async () => {
    const en = await import('../i18n/en.json');
    const fr = await import('../i18n/fr.json');
    expect((en.default as any).admin.tabs.geography).toBeUndefined();
    expect((fr.default as any).admin.tabs.geography).toBeUndefined();
    expect((en.default as any).admin.geography).toBeUndefined();
    expect((fr.default as any).admin.geography).toBeUndefined();
  });

  it('7-8. the Role Assignments description no longer mentions Geography in either language', async () => {
    const en = await import('../i18n/en.json');
    const fr = await import('../i18n/fr.json');
    expect((en.default as any).admin.roleAssignments.description).not.toMatch(/geography/i);
    expect((fr.default as any).admin.roleAssignments.description).not.toMatch(/g[ée]ographi/i);
  });
});

describe('Final Geography Retirement — PeopleTab', () => {
  it('1, 9. the People list renders with no Geography column or text, and existing People functionality is intact', async () => {
    mockFetchByUrl({
      '/api/admin/people?page=': {
        status: 200,
        body: {
          items: [
            {
              id: 'p1',
              name: 'Jane Doe',
              whatsappNumber: '+237600000001',
              email: null,
              preferredLanguage: 'en',
              _count: { communityMemberships: 1, registrations: 0 },
            },
          ],
          pagination: { totalPages: 1 },
        },
      },
    });

    render(<PeopleTab includeTestData={false} />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Geography/i)).not.toBeInTheDocument();
  });
});
