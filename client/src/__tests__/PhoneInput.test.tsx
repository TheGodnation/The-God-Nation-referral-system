import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PhoneInput } from '../components/PhoneInput';
import { MemberSignupPage } from '../pages/MemberSignupPage';
import { fullNumber, splitInternational, sortedCountries, dialOf, COUNTRIES } from '../lib/countries';
import i18n from '../i18n';

// The phone box: the country is chosen from a list (Cameroon first, +237), the code is added by itself,
// and a number typed or pasted with its "+" puts the person in the right country.
afterEach(() => {
  vi.unstubAllGlobals();
  i18n.changeLanguage('en');
});

describe('Country list and number building', () => {
  it('puts Cameroon first, then the others by name, in English and French', () => {
    const en = sortedCountries('en');
    expect(en[0]).toMatchObject({ iso: 'CM', dial: '237' });
    expect(en.length).toBe(COUNTRIES.length);
    const names = en.slice(1).map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(sortedCountries('fr').find((c) => c.iso === 'DE')?.name).toBe('Allemagne');
    expect(dialOf('NG')).toBe('234');
    expect(dialOf('FR')).toBe('33');
  });

  it('adds the code, drops a leading 0, and gives nothing while nothing is typed', () => {
    expect(fullNumber('CM', '6 70 94 40 11')).toBe('+237670944011');
    expect(fullNumber('FR', '06 12 34 56 78')).toBe('+33612345678');
    expect(fullNumber('IT', '06 1234 5678')).toBe('+390612345678');
    expect(fullNumber('CM', '')).toBe('');
    expect(fullNumber('CM', '  -- ')).toBe('');
  });

  it('recognises a number typed with its "+": the longest code, Cameroon for its own', () => {
    expect(splitInternational('+237 670 944 011')).toEqual({ iso: 'CM', national: '670944011' });
    expect(splitInternational('+234 803 123 4567')).toEqual({ iso: 'NG', national: '8031234567' });
    expect(splitInternational('+1 202 555 0100')).toEqual({ iso: 'US', national: '2025550100' });
    expect(splitInternational('+33 6 12 34 56 78')).toEqual({ iso: 'FR', national: '612345678' });
    expect(splitInternational('670944011')).toBeNull();
  });
});

describe('Phone box', () => {
  it('starts on Cameroon +237 and sends the whole number', () => {
    const seen: string[] = [];
    render(<PhoneInput id="p" onChange={(v) => seen.push(v)} />);
    expect((screen.getByTestId('phone-country') as HTMLSelectElement).value).toBe('CM');
    expect(screen.getByTestId('phone-code')).toHaveTextContent('+237');
    fireEvent.change(document.getElementById('p')!, { target: { value: '670944011' } });
    expect(seen[seen.length - 1]).toBe('+237670944011');
  });

  it('changes the code when another country is chosen, and keeps the number typed', () => {
    const seen: string[] = [];
    render(<PhoneInput id="p" onChange={(v) => seen.push(v)} />);
    fireEvent.change(document.getElementById('p')!, { target: { value: '803 123 4567' } });
    fireEvent.change(screen.getByTestId('phone-country'), { target: { value: 'NG' } });
    expect(screen.getByTestId('phone-code')).toHaveTextContent('+234');
    expect(seen[seen.length - 1]).toBe('+2348031234567');
  });

  it('puts a pasted "+33…" number in France and keeps only the rest in the box', () => {
    const seen: string[] = [];
    render(<PhoneInput id="p" onChange={(v) => seen.push(v)} />);
    fireEvent.change(document.getElementById('p')!, { target: { value: '+33 6 12 34 56 78' } });
    expect((screen.getByTestId('phone-country') as HTMLSelectElement).value).toBe('FR');
    expect((document.getElementById('p') as HTMLInputElement).value).toBe('612345678');
    expect(seen[seen.length - 1]).toBe('+33612345678');
  });

  it('names the countries in French when the app is in French', async () => {
    await i18n.changeLanguage('fr');
    render(<PhoneInput id="p" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: /Cameroun \(\+237\)/ })).toBeInTheDocument();
  });

  it('is on the sign-up page: Cameroon by default, and what is sent is the whole number', async () => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
        const ok = url.includes('/api/member/auth/signup');
        return Promise.resolve({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => (ok ? { message: 'ok' } : { error: 'not found' }) });
      }),
    );
    render(
      <MemoryRouter>
        <MemberSignupPage />
      </MemoryRouter>,
    );
    expect((screen.getByTestId('phone-country') as HTMLSelectElement).value).toBe('CM');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Phone number (WhatsApp)'), { target: { value: '670944011' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Testpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me the link' }));
    await waitFor(() => expect(calls.find((c) => c.url.includes('/api/member/auth/signup'))?.body.whatsapp).toBe('+237670944011'));
  });
});
