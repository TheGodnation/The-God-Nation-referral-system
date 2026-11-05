import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchPicker } from '../components/admin/SearchPicker';

function mock(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body })));
}
afterEach(() => vi.unstubAllGlobals());

const picker = () => <SearchPicker placeholder="Search person" searchPath="/api/admin/people?search=" renderLabel={(p) => p.name} actionLabel="Select" searchButtonLabel="Search" onPick={() => {}} />;

describe('SearchPicker', () => {
  it('lists what it finds, and says so when nobody is found', async () => {
    mock(200, { items: [{ id: 'p1', name: 'Gertrude Etabu' }] });
    const { unmount } = render(picker());
    fireEvent.change(screen.getByPlaceholderText('Search person'), { target: { value: 'Etabu Gertrude' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('option', { name: 'Gertrude Etabu' })).toBeInTheDocument();
    unmount();

    mock(200, { items: [] });
    render(picker());
    fireEvent.change(screen.getByPlaceholderText('Search person'), { target: { value: 'Nobody' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Nobody found/)).toBeInTheDocument();
  });

  it('says so when the search itself fails', async () => {
    mock(500, { error: 'boom' });
    render(picker());
    fireEvent.change(screen.getByPlaceholderText('Search person'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText(/could not be done/)).toBeInTheDocument());
  });
});
