import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenMemberProfileButton } from '../components/OpenMemberProfileButton';

// A leader / the central admin opens their member profile from the dashboard
// without signing in a second time.
const assign = vi.fn();

function setup(status: number) {
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => (status < 300 ? { ok: true } : { error: 'none', code: 'NO_MEMBER_PROFILE' }) })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenMemberProfileButton', () => {
  it('opens the member side right away when the member profile can be opened', async () => {
    setup(200);
    render(<OpenMemberProfileButton endpoint="/api/admin/me/open-member-profile">View my Member profile</OpenMemberProfileButton>);
    fireEvent.click(screen.getByRole('button', { name: 'View my Member profile' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/member/me'));
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/admin/me/open-member-profile');
  });

  it('falls back to the member sign-in page when there is nothing to open', async () => {
    setup(404);
    render(<OpenMemberProfileButton endpoint="/api/leader/me/open-member-profile">View my Member profile</OpenMemberProfileButton>);
    fireEvent.click(screen.getByRole('button', { name: 'View my Member profile' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/member/login'));
  });
});
