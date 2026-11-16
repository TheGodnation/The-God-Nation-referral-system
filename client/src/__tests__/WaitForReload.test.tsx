import { describe, it, expect } from 'vitest';
import { lazy, Suspense } from 'react';
import { render, screen, act } from '@testing-library/react';
import { waitForReload } from '../lib/waitForReload';
import { ErrorBoundary } from '../components/ErrorBoundary';

// Right after an update, a stale screen file "loads" as nothing while the page reloads itself.
describe('a screen whose file vanished after an update', () => {
  it('keeps showing its loading state instead of an error while the page reloads', async () => {
    const Page = lazy(() =>
      Promise.resolve(undefined as unknown as { Gone: () => JSX.Element }).then((m) => (m ? { default: m.Gone } : waitForReload())),
    );
    render(
      <ErrorBoundary>
        <Suspense fallback={<p>Loading…</p>}>
          <Page />
        </Suspense>
      </ErrorBoundary>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('a screen that loads normally still shows', async () => {
    const Page = lazy(() => Promise.resolve({ Here: () => <p>Hello</p> }).then((m) => (m ? { default: m.Here } : waitForReload())));
    render(
      <Suspense fallback={<p>Loading…</p>}>
        <Page />
      </Suspense>,
    );
    expect(await screen.findByText('Hello')).toBeInTheDocument();
  });
});
