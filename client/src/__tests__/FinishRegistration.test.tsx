import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FollowUpButtons } from '../components/leader/FollowUpButtons';
import { WhatsAppQueue, type QueuePerson } from '../components/admin/WhatsAppQueue';
import i18n from '../i18n';

// Helping someone finish registering: a WhatsApp message with the right link (sign in with email, then name, country and
// place), in their language, one person at a time or through the queue. Nothing is sent by the app.
beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ content: {} }) })));
});
afterEach(() => vi.unstubAllGlobals());

const decoded = (el: HTMLElement) => decodeURIComponent(el.getAttribute('href')!);
const LINK = () => `${window.location.origin}/member/login?continue=1`;

describe('"Help them finish registering" on a person', () => {
  it('opens WhatsApp with the link and their first name, in their own language', () => {
    render(<MemoryRouter><FollowUpButtons personId="p1" whatsapp="+237600000001" language="en" name="Grace Mbah" needsToFinish /></MemoryRouter>);
    const href = decoded(screen.getByTestId('followup-finish-p1'));
    expect(href).toContain('https://wa.me/237600000001');
    expect(href).toContain('Hello Grace, welcome to The God Nation!');
    expect(href).toContain(LINK());
    expect(href).toContain('You are already registered with us');
    expect(href).toContain('your name, your country and where you live');
    expect(href).not.toContain('{{');
  });

  it('speaks French for a French reader, with the French link', () => {
    render(<MemoryRouter><FollowUpButtons personId="p2" whatsapp="+237600000002" language="fr" name="Marie Ngono" needsToFinish /></MemoryRouter>);
    const href = decoded(screen.getByTestId('followup-finish-p2'));
    expect(href).toContain('Bonjour Marie, bienvenue à The God Nation !');
    expect(href).toContain(`${LINK()}&lang=fr`);
    expect(href).toContain('Vous êtes déjà inscrit(e) chez nous');
  });

  it('is not shown for someone who has finished registering', () => {
    render(<MemoryRouter><FollowUpButtons personId="p3" whatsapp="+237600000003" language="en" name="Done Person" /></MemoryRouter>);
    expect(screen.queryByTestId('followup-finish-p3')).toBeNull();
    expect(screen.getByTestId('followup-hello-p3')).toBeInTheDocument();
  });
});

describe('The queue for people who have not finished', () => {
  const people: QueuePerson[] = [
    { personId: 'a', name: 'Agnes Agreed', whatsapp: '+237600000001', language: 'en', consent: 'AGREED' },
    { personId: 'n', name: 'Noël None', whatsapp: '+237600000002', language: 'fr', consent: 'NONE' },
    { personId: 'o', name: 'Olive Optedout', whatsapp: '+237600000003', language: 'en', consent: 'OPTED_OUT' },
  ];

  it('opens with the "finish registering" text already there, and reaches people who never ticked (it is help, not a nudge)', () => {
    render(<WhatsAppQueue people={people} onClose={() => {}} recordContact={() => {}} defaultKind="help" defaultTemplate="finish" />);
    expect((screen.getByTestId('queue-text-en') as HTMLTextAreaElement).value).toContain('already registered');
    expect((screen.getByTestId('queue-text-fr') as HTMLTextAreaElement).value).toContain('déjà inscrit(e)');
    expect(screen.getByTestId('queue-start').textContent).toMatch(/\b2\b/);
    fireEvent.click(screen.getByTestId('queue-start'));
    const first = decoded(screen.getByTestId('queue-open'));
    expect(first).toContain('Hello Agnes, welcome to The God Nation!');
    expect(first).toContain(LINK());
    expect(first).not.toContain('{link}');
    fireEvent.click(screen.getByTestId('queue-next'));
    const second = decoded(screen.getByTestId('queue-open'));
    expect(second).toContain('Bonjour Noël');
    expect(second).toContain(`${LINK()}&lang=fr`);
  });

  it('the text can also be loaded with a button, and only for help messages', () => {
    render(<WhatsAppQueue people={people} onClose={() => {}} recordContact={() => {}} />);
    expect(screen.queryByTestId('queue-template-finish')).toBeNull(); // starts on "we miss you"
    fireEvent.click(screen.getByTestId('queue-kind-help'));
    fireEvent.click(screen.getByTestId('queue-template-finish'));
    expect((screen.getByTestId('queue-text-en') as HTMLTextAreaElement).value).toContain('Tap this link, enter the same email you used');
  });
});

describe('A personal link to continue', () => {
  it('makes a private link for this person, then opens WhatsApp with it in their language', async () => {
    const makeLink = vi.fn(async () => 'https://thegodnationacademy.org/member/password-help?token=abc123');
    const win: { location: { href: string }; close: () => void } = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    render(<MemoryRouter><FollowUpButtons personId="p9" whatsapp="+237600000009" language="fr" name="Marie Ngono" needsToFinish personalLink={makeLink} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('followup-personal-p9'));
    await vi.waitFor(() => expect(win.location.href).toContain('https://wa.me/237600000009'));
    expect(makeLink).toHaveBeenCalledWith('p9');
    const text = decodeURIComponent(win.location.href);
    expect(text).toContain('Bonjour Marie');
    expect(text).toContain('https://thegodnationacademy.org/member/password-help?token=abc123');
    expect(text).toContain('Ce lien est réservé à vous');
  });

  it('closes the blank window and says so when the link cannot be made', async () => {
    const win = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    render(<MemoryRouter><FollowUpButtons personId="p8" whatsapp="+237600000008" language="en" name="Ada" needsToFinish personalLink={async () => { throw new Error('no'); }} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('followup-personal-p8'));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be made');
    expect(win.close).toHaveBeenCalled();
  });

  it('is only offered where the sender can make it (the coordinator), and only to people who need to finish', () => {
    render(<MemoryRouter><FollowUpButtons personId="p7" whatsapp="+237600000007" language="en" name="Leader View" needsToFinish /></MemoryRouter>);
    expect(screen.queryByTestId('followup-personal-p7')).toBeNull();
  });
});

