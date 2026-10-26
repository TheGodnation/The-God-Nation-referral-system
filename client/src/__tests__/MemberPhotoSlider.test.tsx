import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberPhotoSlider } from '../components/member/MemberPhotoSlider';

function mockFetch(items: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ items }),
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSlider() {
  return render(
    <MemoryRouter initialEntries={['/member/updates']}>
      <Routes>
        <Route path="/member/updates" element={<MemberPhotoSlider />} />
        <Route path="/member/people/:personId" element={<div>Profile page for the tapped member</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MemberPhotoSlider', () => {
  it('renders each member and navigates to their profile on tap', async () => {
    mockFetch([
      { personId: 'p1', name: 'Grace Mbeki', photoUrl: '/api/people/p1/photo?v=1' },
      { personId: 'p2', name: 'John Tabi', photoUrl: '/api/people/p2/photo?v=2' },
    ]);
    renderSlider();

    await waitFor(() => expect(screen.getByText('Grace Mbeki')).toBeInTheDocument());
    expect(screen.getByText('John Tabi')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Grace Mbeki' }));
    await waitFor(() => expect(screen.getByText('Profile page for the tapped member')).toBeInTheDocument());
  });

  it('shows people without a photo as initials cards, after those with one, and ends with See everyone', async () => {
    mockFetch([
      { personId: 'p1', name: 'Grace Mbeki', photoUrl: '/api/people/p1/photo?v=1' },
      { personId: 'p2', name: 'John Tabi', photoUrl: null },
    ]);
    renderSlider();
    await waitFor(() => expect(screen.getByRole('button', { name: 'John Tabi' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'John Tabi' })).toHaveTextContent('JT');
    expect(screen.getByRole('button', { name: 'Grace Mbeki' }).querySelector('img')).toHaveAttribute('src', '/api/people/p1/photo?v=1');
    const seeAll = screen.getByRole('link', { name: /See everyone/ });
    expect(seeAll).toHaveAttribute('href', '/member/people');
  });

  it('renders nothing when no member is found yet', async () => {
    mockFetch([]);
    const { container } = renderSlider();
    await waitFor(() => expect(container.querySelector('button')).not.toBeInTheDocument());
    expect(container).toBeEmptyDOMElement();
  });
});
