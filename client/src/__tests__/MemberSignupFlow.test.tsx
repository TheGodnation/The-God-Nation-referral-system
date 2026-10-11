import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberSignupPage } from '../pages/MemberSignupPage';
import { MemberCompleteProfilePage } from '../pages/MemberCompleteProfilePage';
import { RequireMember } from '../components/RequireMember';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import i18n from '../i18n';

// New member sign-up: step 1 (email + phone) and step 2 (details form),
// plus the redirect that sends a new member to step 2 before anything else.
const calls: { url: string; method: string; body: any }[] = [];

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
  i18n.changeLanguage('en');
});

const NEW_MEMBER = {
  name: 'new@example.com',
  email: 'new@example.com',
  preferredLanguage: 'en',
  locationCountry: null,
  locationCity: null,
  locationArea: null,
  profileComplete: false,
};

describe('MemberSignupPage', () => {
  it('sends email and phone, then tells the visitor to check their email', async () => {
    mockFetchByUrl({ '/api/member/auth/signup': { status: 200, body: { message: 'ok' } } });
    render(
      <MemoryRouter>
        <MemberSignupPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Phone number (WhatsApp)'), { target: { value: '+237670000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me the link' }));

    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());
    const post = calls.find((c) => c.url.includes('/api/member/auth/signup'));
    expect(post?.body).toEqual({ email: 'ada@example.com', whatsapp: '+237670000001', language: 'en' });
  });

  it('shows a clear message for an invalid phone number', async () => {
    mockFetchByUrl({ '/api/member/auth/signup': { status: 400, body: { error: 'x', code: 'INVALID_PHONE' } } });
    render(
      <MemoryRouter>
        <MemberSignupPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Phone number (WhatsApp)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me the link' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Please enter a valid phone number, including the country code.'),
    );
  });
});

describe('RequireMember — new members fill in details first', () => {
  it('redirects a member with an incomplete profile to the details form', async () => {
    mockFetchByUrl({ '/api/member/auth/me': { status: 200, body: { member: NEW_MEMBER } } });
    render(
      <MemoryRouter initialEntries={['/member/dashboard']}>
        <MemberAuthProvider>
          <Routes>
            <Route path="/member/dashboard" element={<RequireMember><p>Dashboard</p></RequireMember>} />
            <Route path="/member/complete-profile" element={<RequireMember><p>Details form</p></RequireMember>} />
          </Routes>
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Details form')).toBeInTheDocument());
  });

  it('lets a member with a complete profile through', async () => {
    mockFetchByUrl({ '/api/member/auth/me': { status: 200, body: { member: { ...NEW_MEMBER, profileComplete: true } } } });
    render(
      <MemoryRouter initialEntries={['/member/dashboard']}>
        <MemberAuthProvider>
          <Routes>
            <Route path="/member/dashboard" element={<RequireMember><p>Dashboard</p></RequireMember>} />
            <Route path="/member/complete-profile" element={<RequireMember><p>Details form</p></RequireMember>} />
          </Routes>
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
  });
});

describe('MemberCompleteProfilePage', () => {
  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/member/complete-profile']}>
        <MemberAuthProvider>
          <Routes>
            <Route path="/member/complete-profile" element={<MemberCompleteProfilePage />} />
            <Route path="/member/dashboard" element={<p>Dashboard</p>} />
          </Routes>
        </MemberAuthProvider>
      </MemoryRouter>,
    );
  }

  it('asks for all Cameroon location fields before submitting', async () => {
    mockFetchByUrl({ '/api/member/auth/me': { status: 200, body: { member: NEW_MEMBER } } });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Region')).toBeInTheDocument());
    // The placeholder name (their email) is not shown as their name.
    expect(screen.getByLabelText('Full name')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Enter the community' }));
    expect(screen.getAllByText('Please fill this in.').length).toBe(5);
    expect(calls.some((c) => c.url.includes('complete-profile'))).toBe(false);
  });

  it('submits Cameroon details and goes to the community', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': { status: 200, body: { member: NEW_MEMBER } },
      '/api/member/auth/complete-profile': { status: 200, body: { profileComplete: true, community: { id: 'hq', name: 'HQ' } } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Region')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Jean Ngono' } });
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'Centre' } });
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'Mfoundi' } });
    fireEvent.change(screen.getByLabelText('Subdivision'), { target: { value: 'Yaoundé III' } });
    fireEvent.change(screen.getByLabelText('Quarter'), { target: { value: 'Efoulan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter the community' }));

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
    const post = calls.find((c) => c.url.includes('/api/member/auth/complete-profile'));
    expect(post?.body).toEqual({
      name: 'Jean Ngono',
      preferredLanguage: 'en',
      country: 'Cameroon',
      region: 'Centre',
      division: 'Mfoundi',
      subdivision: 'Yaoundé III',
      quarter: 'Efoulan',
    });
  });

  it('asks only for a city outside Cameroon', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': { status: 200, body: { member: NEW_MEMBER } },
      '/api/member/auth/complete-profile': { status: 200, body: { profileComplete: true, community: null } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Country')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Nigeria' } });
    expect(screen.queryByLabelText('Region')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('City or town'), { target: { value: 'Lagos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter the community' }));

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
    const post = calls.find((c) => c.url.includes('/api/member/auth/complete-profile'));
    expect(post?.body).toEqual({ name: 'Ada', preferredLanguage: 'en', country: 'Nigeria', city: 'Lagos' });
  });
});
