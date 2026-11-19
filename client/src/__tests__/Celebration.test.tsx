import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n';
import { CelebrationPage } from '../pages/CelebrationPage';
import { CelebrationPanel } from '../components/admin/CelebrationPanel';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); // the test browser cannot draw
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

const PAGE = {
  title: { en: 'Congratulations to our students!', fr: 'Félicitations à nos étudiants !' },
  intro: { en: 'They finished all 15 books.', fr: 'Ils ont terminé les 15 livres.' },
  message: { en: 'Dear students, well done.\n\nStay humble.\n\nEvangelist', fr: 'Chers étudiants, bravo.\n\nRestez humbles.\n\nÉvangéliste' },
  names: ['Alpha Tester', 'Beta Tester', 'Gamma Tester'],
};
const page = () => render(<MemoryRouter><CelebrationPage /></MemoryRouter>);
// The page frame also asks for the public settings; the celebration answer is only for its own address.
const serve = (celebration: () => Promise<unknown>) => vi.fn((url: string) => (String(url).includes('/api/celebration') ? celebration() : json({ content: {} })));

describe('The Congratulations page', () => {
  it('shows the title, how many students, each name, the words, and a button to begin training', async () => {
    vi.stubGlobal('fetch', serve(() => json(PAGE)));
    page();
    expect(await screen.findByTestId('celebration-title')).toHaveTextContent('Congratulations to our students!');
    expect(screen.getByText('3 students completed the 15 books')).toBeInTheDocument();
    expect(screen.getByTestId('celebration-names')).toHaveTextContent('Alpha Tester');
    expect(screen.getByTestId('celebration-names')).toHaveTextContent('Gamma Tester');
    expect(screen.getByTestId('celebration-message')).toHaveTextContent('Dear students, well done.');
    expect(screen.getByTestId('celebration-message').querySelectorAll('p')).toHaveLength(3);
    expect(screen.getByTestId('celebration-cta')).toHaveAttribute('href', '/member/join');
    expect(screen.getByTestId('celebration-cta')).toHaveTextContent('Begin your own training');
  });

  it('reads in French for a French visitor', async () => {
    await i18n.changeLanguage('fr');
    vi.stubGlobal('fetch', serve(() => json(PAGE)));
    page();
    expect(await screen.findByTestId('celebration-title')).toHaveTextContent('Félicitations à nos étudiants !');
    expect(screen.getByText('3 étudiants ont terminé les 15 livres')).toBeInTheDocument();
    expect(screen.getByTestId('celebration-cta')).toHaveTextContent('Commencer ma formation');
  });

  it('says it is not open yet when the admin has not switched it on', async () => {
    vi.stubGlobal('fetch', serve(() => json({ error: 'Not open yet.' }, 404)));
    page();
    expect(await screen.findByTestId('celebration-closed')).toHaveTextContent('This page is not open yet');
    expect(screen.queryByTestId('celebration-names')).toBeNull();
  });
});

const DATA = { saved: true, published: false, titleEn: 'Well done', titleFr: 'Bravo', introEn: 'They finished.', introFr: 'Ils ont fini.', messageEn: 'Words.', messageFr: 'Mots.', names: ['Alpha Tester'] };

describe('The Congratulations panel (central admin)', () => {
  it('shows the words and names, fills the names from the teaching list, and saves and opens the page', async () => {
    const puts: any[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { const b = JSON.parse(String(init.body)); puts.push(b); return json({ ...DATA, ...b, saved: true }); }
      if (url.endsWith('/teaching-names')) return json({ names: ['Alpha Tester', 'Beta Tester', 'Gamma Tester'] });
      return json(DATA);
    }));
    render(<CelebrationPanel base="/api/admin/celebration" />);
    await screen.findByText('The page is closed');
    expect(screen.getByLabelText('Names')).toHaveValue('Alpha Tester');
    expect(screen.getByTestId('share-en')).toBeDisabled(); // nothing to share while closed
    fireEvent.click(screen.getByText('Use the names on the weekly teaching list'));
    await screen.findByText(/3 names filled in from the teaching list/);
    expect(screen.getByLabelText('Names')).toHaveValue('Alpha Tester\nBeta Tester\nGamma Tester');
    fireEvent.click(screen.getByTestId('celebration-switch'));
    await screen.findByText('Saved. The page is open.');
    expect(puts[0]).toMatchObject({ published: true, names: ['Alpha Tester', 'Beta Tester', 'Gamma Tester'], titleEn: 'Well done', messageFr: 'Mots.' });
    expect(screen.getByTestId('share-en')).not.toBeDisabled();
  });

  it('opens WhatsApp with the link in the chosen language', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ ...DATA, published: true })));
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(<CelebrationPanel base="/api/admin/celebration" />);
    await screen.findByText(/The page is OPEN/);
    fireEvent.click(screen.getByTestId('share-fr'));
    expect(open).toHaveBeenCalled();
    const url = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(url).toContain('https://wa.me/?text=');
    expect(url).toContain('Bravo');
    expect(url).toContain('/congratulations?lang=fr');
  });

  it('shows the reason when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (init?.method === 'PUT' ? json({ error: 'Check the words and names and try again.' }, 400) : json(DATA))));
    render(<CelebrationPanel base="/api/admin/celebration" />);
    await screen.findByText('The page is closed');
    fireEvent.click(screen.getByTestId('celebration-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the words and names');
    await waitFor(() => expect(screen.getByTestId('celebration-save')).not.toBeDisabled());
  });
});
