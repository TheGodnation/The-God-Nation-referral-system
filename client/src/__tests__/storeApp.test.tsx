import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', () => ({ api: { post: vi.fn().mockResolvedValue({}), get: vi.fn() }, ApiError: class extends Error {} }));
import { api } from '../lib/api';
import { isStoreApp } from '../lib/storeApp';
import { BookStatusLines, PayPromptCard, TrainingStatusCard, type SchoolBook, type SchoolSummary } from '../components/learn/schoolBits';

const book = (over: Partial<SchoolBook> = {}): SchoolBook => ({ id: 'b1', trainingOrder: 1, titleEn: 'One', titleFr: null, descriptionEn: null, descriptionFr: null, unlocked: false, canRead: false, exam: null, ...over });
const summary = (over: Partial<SchoolSummary> = {}): SchoolSummary => ({ enrollment: 'NONE', books: [book()], price: 1200, ...over });

function setUrl(search: string) {
  window.history.replaceState({}, '', `/member/school${search}`);
}
function setReferrer(value: string) {
  Object.defineProperty(document, 'referrer', { value, configurable: true });
}
beforeEach(() => {
  sessionStorage.clear();
  setUrl('');
  setReferrer('');
  vi.mocked(api.post).mockClear();
});
afterEach(() => setUrl(''));

describe('knowing it is the Play Store version', () => {
  it('is the Play version when Play opened the app, and stays so for the session', () => {
    expect(isStoreApp()).toBe(false);
    setReferrer('android-app://org.thegodnationacademy.app/');
    expect(isStoreApp()).toBe(true);
    setReferrer('https://thegodnationacademy.org/'); // a later reload inside the app
    expect(isStoreApp()).toBe(true);
  });

  it('?app=play shows the Play version in any browser, and ?app=web leaves it', () => {
    setUrl('?app=play');
    expect(isStoreApp()).toBe(true);
    setUrl('?app=web');
    expect(isStoreApp()).toBe(false);
  });

  it('is not remembered in long-term storage (the phone’s Chrome shares it)', () => {
    setUrl('?app=play');
    isStoreApp();
    expect(Object.keys(localStorage).some((k) => k.includes('store-app'))).toBe(false);
  });
});

describe('the Play version asks to read instead of paying', () => {
  const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it('on the web, the price and the "Begin my training" button are as before', () => {
    wrap(<TrainingStatusCard summary={summary()} onChanged={() => {}} />);
    expect(screen.getByText(/1\s?200/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request to read' })).toBeNull();
  });

  it('in the Play version there is no price, and "Request to read" asks the central team', async () => {
    setUrl('?app=play');
    const changed = vi.fn();
    const { container } = wrap(<TrainingStatusCard summary={summary()} onChanged={changed} />);
    expect(container.textContent).not.toMatch(/FCFA|1\s?200|1\s?100/);
    fireEvent.click(screen.getByRole('button', { name: 'Request to read' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/api/member/training/request', { approval: true });
  });

  it('after asking, it says the request is with the central team (and offers no second button)', () => {
    setUrl('?app=play');
    wrap(<TrainingStatusCard summary={summary({ enrollment: 'REQUESTED' })} onChanged={() => {}} />);
    expect(screen.getByText(/Your request has been sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('once approved, the next book is asked for the same way, with no money wording', async () => {
    setUrl('?app=play');
    const s = summary({ enrollment: 'ACTIVE', maxGraceBooks: 5, owed: { books: 1, amount: 1200 }, books: [book({ unlocked: true, canRead: true }), book({ id: 'b2', trainingOrder: 2, lockedBecause: 'PAYMENT' })] });
    const { container } = wrap(<TrainingStatusCard summary={s} onChanged={() => {}} />);
    expect(container.textContent).not.toMatch(/FCFA|1\s?200|owe|pay/i);
    fireEvent.click(screen.getByRole('button', { name: 'Request to read the next book' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/member/training/grace', { books: 2 }));
  });

  it('hides the "pay for your books" card and the payment lines under a book', () => {
    setUrl('?app=play');
    const s = summary({ enrollment: 'ACTIVE', payableCount: 2, owed: { books: 1, amount: 1200 }, books: [book({ unlocked: true, payment: 'PAID' }), book({ id: 'b2', trainingOrder: 2, lockedBecause: 'PAYMENT' })] });
    const { container } = wrap(
      <>
        <PayPromptCard summary={s} />
        <BookStatusLines book={s.books[0]} />
        <BookStatusLines book={s.books[1]} />
      </>,
    );
    expect(screen.queryByTestId('pay-prompt-card')).toBeNull();
    expect(container.textContent).not.toMatch(/Paid|paid|pay/);
    expect(screen.getByText('This book opens when the central team approves your request.')).toBeInTheDocument();
  });
});

describe('Giving and Earnings in the Play version', () => {
  it('are reachable on the web, and send the person back to their profile in the Play version', async () => {
    const { StoreHidden } = await import('../components/StoreHidden');
    const { Routes, Route } = await import('react-router-dom');
    const ui = () => (
      <MemoryRouter initialEntries={['/member/give']}>
        <Routes>
          <Route path="/member/give" element={<StoreHidden><p>Give page</p></StoreHidden>} />
          <Route path="/member/me" element={<p>My profile</p>} />
        </Routes>
      </MemoryRouter>
    );
    const web = render(ui());
    expect(screen.getByText('Give page')).toBeInTheDocument();
    web.unmount();
    setUrl('?app=play');
    render(ui());
    expect(screen.getByText('My profile')).toBeInTheDocument();
    expect(screen.queryByText('Give page')).toBeNull();
  });
});
