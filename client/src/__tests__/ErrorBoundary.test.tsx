import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../components/ErrorBoundary';

function Bomb(): never {
  throw new Error('boom');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function ThrowsStale(): never {
  throw new TypeError('Failed to fetch dynamically imported module: https://x.org/assets/Page-abc.js');
}

describe('ErrorBoundary', () => {
  it('renders its children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows a reload screen instead of a blank page when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload/ })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('shows what went wrong in small print and reports it to the server', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('/api/client-errors');
    expect(JSON.parse(init.body)).toMatchObject({ kind: 'render', message: 'boom' });
  });

  it('loads the page again by itself when the app was updated under an open page (a missing file)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, pathname: '/member/chats' });
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ErrorBoundary>
        <ThrowsStale />
      </ErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not reload in a loop: a second missing-file error within a minute shows the screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.setItem('app-reloaded-at', String(Date.now()));
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, pathname: '/' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
    render(
      <ErrorBoundary>
        <ThrowsStale />
      </ErrorBoundary>,
    );
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });
});
