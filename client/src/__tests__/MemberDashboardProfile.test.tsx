import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberDashboardPage } from '../pages/MemberDashboardPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import i18n from '../i18n';

// Phase 3F — same URL-dispatching fetch mock pattern as
// MemberDashboardTrainingProgress.test.tsx (Phase 3E). Records every call
// so the test can assert exactly what the profile-save request sent.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
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
  calls.length = 0;
  // This test intentionally exercises the "changing preferredLanguage also
  // switches the live UI language" behavior, which mutates the shared i18n
  // singleton — reset it so it never leaks into another test in this file.
  i18n.changeLanguage('en');
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <MemberAuthProvider>
        <MemberDashboardPage />
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

const BASE_RESPONSES = {
  '/api/member/devotionals': { status: 200, body: { items: [] } },
  '/api/member/me/community-memberships': { status: 200, body: { items: [] } },
  '/api/member/me/geographic-assignment': { status: 200, body: { assignment: null } },
  '/api/member/me/training-progress': { status: 200, body: { totalEligible: 0, completedCount: 0, items: [] } },
};

describe('MemberDashboardPage — Phase 3F profile self-service', () => {
  it('lets a member update their name and preferred language, showing a save confirmation', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': { status: 200, body: { member: { name: 'Jane', email: 'jane@example.com', preferredLanguage: 'en' } } },
      ...BASE_RESPONSES,
      '/api/member/me/profile': { status: 200, body: { name: 'Jane Updated', preferredLanguage: 'fr' } },
    });

    renderDashboard();

    const nameInput = await screen.findByDisplayValue('Jane');
    fireEvent.change(nameInput, { target: { value: 'Jane Updated' } });

    const languageSelect = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(languageSelect, { target: { value: 'fr' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(screen.getByText('Profil mis à jour.')).toBeInTheDocument();
    });

    const patchCall = calls.find((c) => c.url.includes('/api/member/me/profile') && c.method === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect(patchCall!.body).toEqual({
      name: 'Jane Updated',
      preferredLanguage: 'fr',
      locationCountry: '',
      locationCity: '',
      locationArea: '',
    });
  });

  it('shows a validation/error state when the save fails', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': { status: 200, body: { member: { name: 'Jane', email: 'jane@example.com', preferredLanguage: 'en' } } },
      ...BASE_RESPONSES,
      '/api/member/me/profile': { status: 400, body: { error: 'Name is required.' } },
    });

    renderDashboard();

    await screen.findByDisplayValue('Jane');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(screen.getByText('Name is required.')).toBeInTheDocument();
    });
  });
});

describe('MemberDashboardPage — Member Location', () => {
  it('pre-fills existing location values', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': {
        status: 200,
        body: {
          member: {
            name: 'Jane',
            email: 'jane@example.com',
            preferredLanguage: 'en',
            locationCountry: 'Cameroon',
            locationCity: 'Douala',
            locationArea: 'Bonamoussadi',
          },
        },
      },
      ...BASE_RESPONSES,
    });

    renderDashboard();

    await screen.findByDisplayValue('Cameroon');
    expect(screen.getByDisplayValue('Douala')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bonamoussadi')).toBeInTheDocument();
  });

  it('lets a member set their country/city/area and save them', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': { status: 200, body: { member: { name: 'Jane', email: 'jane@example.com', preferredLanguage: 'en' } } },
      ...BASE_RESPONSES,
      '/api/member/me/profile': {
        status: 200,
        body: { name: 'Jane', preferredLanguage: 'en', locationCountry: 'Cameroon', locationCity: 'Douala', locationArea: 'Bonamoussadi' },
      },
    });

    renderDashboard();

    await screen.findByDisplayValue('Jane');
    // The profile form's labels aren't programmatically associated with
    // their inputs (matching this file's own existing convention of
    // locating the name field by display value rather than by label), so
    // the three location text inputs are located by their DOM order
    // (name, country, city, area — the language <select> isn't a textbox).
    const [, countryInput, cityInput, areaInput] = screen.getAllByRole('textbox');
    fireEvent.change(countryInput, { target: { value: 'Cameroon' } });
    fireEvent.change(cityInput, { target: { value: 'Douala' } });
    fireEvent.change(areaInput, { target: { value: 'Bonamoussadi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.url.includes('/api/member/me/profile') && c.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(patchCall!.body).toEqual({
        name: 'Jane',
        preferredLanguage: 'en',
        locationCountry: 'Cameroon',
        locationCity: 'Douala',
        locationArea: 'Bonamoussadi',
      });
    });
  });

  it('leaves location fields blank without any validation error', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': { status: 200, body: { member: { name: 'Jane', email: 'jane@example.com', preferredLanguage: 'en' } } },
      ...BASE_RESPONSES,
      '/api/member/me/profile': { status: 200, body: { name: 'Jane', preferredLanguage: 'en' } },
    });

    renderDashboard();

    await screen.findByDisplayValue('Jane');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(screen.getByText('Profile updated.')).toBeInTheDocument();
    });
  });
});
