import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PersonPowers } from '../components/admin/PersonPowers';

function mock(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body })));
}
afterEach(() => vi.unstubAllGlobals());

const base = { centralAdmin: false, hasDashboard: false, leaderAccount: null, assemblies: [], areas: [], nationalTeamTitle: null, notes: [] };

describe('What this person can do', () => {
  it('lists the powers of someone who leads an assembly, and says the leader dashboard is missing', async () => {
    mock({ ...base, assemblies: [{ communityId: 'c1', name: 'Headquarter Assembly' }], notes: ['LEADS_ASSEMBLY_NO_LEADER_ACCOUNT'] });
    render(<PersonPowers personId="p1" />);
    const panel = await screen.findByTestId('person-powers');
    expect(panel).toHaveTextContent('Leads: Headquarter Assembly');
    expect(panel).toHaveTextContent("Remove other people's messages in the chat");
    expect(panel).toHaveTextContent('See the results of its teachings');
    expect(panel).toHaveTextContent('No leader dashboard yet.');
    expect(screen.getByTestId('power-notes')).toHaveTextContent('Assign as Leader');
  });

  it('shows the dashboard, the places represented and the National Team, and tells them to sign in once', async () => {
    mock({
      ...base,
      hasDashboard: true,
      leaderAccount: { active: true, email: 'a@b.c' },
      assemblies: [{ communityId: 'c1', name: 'Buea Assembly' }],
      areas: [{ areaId: 'a1', level: 'SUBDIVISION', title: 'Subdivision Coordinator', place: 'Buea, Fako, South-West, Cameroon' }],
      nationalTeamTitle: 'Director of Training',
      notes: ['SIGN_IN_AGAIN_ONCE'],
    });
    render(<PersonPowers personId="p2" />);
    const panel = await screen.findByTestId('person-powers');
    expect(panel).toHaveTextContent('Has the My Leadership Dashboard');
    expect(panel).toHaveTextContent('Subdivision Coordinator: Buea, Fako, South-West, Cameroon');
    expect(panel).toHaveTextContent('National Team: Director of Training');
    expect(screen.getByTestId('power-notes')).toHaveTextContent('sign out and sign in once');
  });

  it('says so for an ordinary member', async () => {
    mock(base);
    render(<PersonPowers personId="p3" />);
    expect(await screen.findByText(/No leadership powers yet/)).toBeInTheDocument();
  });
});
