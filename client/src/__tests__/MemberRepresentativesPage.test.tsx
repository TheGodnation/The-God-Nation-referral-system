import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberRepresentativesPage } from '../pages/MemberRepresentativesPage';

function mock(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const status = url.startsWith('/api/member/leadership-directory/representatives') ? 200 : 404;
      return Promise.resolve({ ok: status === 200, status, headers: { get: () => 'application/json' }, json: async () => (status === 200 ? body : {}) });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const render_ = () =>
  render(
    <MemoryRouter initialEntries={['/member/representatives']}>
      <Routes>
        <Route path="/member/representatives" element={<MemberRepresentativesPage />} />
        <Route path="/member/people/:personId" element={<p>Person Profile Page</p>} />
        <Route path="/member/represent" element={<p>The request page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('The wall of representatives', () => {
  it('shows the photos of the representatives in my area first, then the others and the National Team', async () => {
    mock({
      inYourArea: [{ personId: 'p1', name: 'Near Rep', photoUrl: null, title: 'Subdivision Coordinator', level: 'SUBDIVISION', place: 'Buea, Fako, South-West, Cameroon', inYourArea: true }],
      elsewhere: [{ personId: 'p2', name: 'Far Rep', photoUrl: null, title: 'Quarter Representative', level: 'QUARTER', place: 'Bepanda, Douala V, Wouri, Littoral, Cameroon', inYourArea: false }],
      nationalTeam: [{ personId: 'p3', name: 'Team Lead', photoUrl: null, title: 'National Coordinator' }],
    });
    render_();
    expect(await screen.findByRole('heading', { name: 'Meet The God Nation representatives in your area' })).toBeInTheDocument();
    const mine = screen.getByRole('region', { name: 'In your area' });
    expect(mine).toHaveTextContent('Near Rep');
    expect(mine).toHaveTextContent('Subdivision Coordinator · Buea');
    expect(screen.getByRole('region', { name: 'Across The God Nation' })).toHaveTextContent('Far Rep');
    expect(screen.getByText('Team Lead')).toBeInTheDocument();
    // Tapping a photo opens that person's profile.
    fireEvent.click(screen.getByRole('button', { name: 'Near Rep' }));
    expect(await screen.findByText('Person Profile Page')).toBeInTheDocument();
  });

  it('says so when nobody represents my area yet, and the request is a separate page', async () => {
    mock({ inYourArea: [], elsewhere: [], nationalTeam: [] });
    render_();
    expect(await screen.findByTestId('none-in-area')).toHaveTextContent('No representative has been appointed in your area yet');
    fireEvent.click(screen.getByTestId('request-link'));
    expect(await screen.findByText('The request page')).toBeInTheDocument();
  });
});
