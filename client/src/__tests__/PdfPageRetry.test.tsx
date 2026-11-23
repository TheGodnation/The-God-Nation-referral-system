import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PdfPage } from '../components/chat/PdfViewer';

// A PDF page that fails to draw (weak connection, phone short of memory) must not stay blank for good.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as never;
});
afterEach(() => vi.useRealTimers());

function fakePdf(failures: number) {
  let calls = 0;
  const rendered = vi.fn();
  return {
    rendered,
    calls: () => calls,
    getPage: vi.fn(async () => {
      calls += 1;
      if (calls <= failures) throw new Error('network');
      return {
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve().then(rendered), cancel: () => {} }),
      };
    }),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('A PDF page that fails to draw', () => {
  it('is tried again by itself, and then draws', async () => {
    vi.useFakeTimers();
    const pdf = fakePdf(2);
    render(<PdfPage pdf={pdf} number={1} width={300} aspect={1.414} />);
    await flush();
    await act(async () => void vi.advanceTimersByTime(1000));
    await flush();
    await act(async () => void vi.advanceTimersByTime(2000));
    await flush();
    expect(pdf.calls()).toBe(3);
    expect(pdf.rendered).toHaveBeenCalled();
    expect(screen.queryByTestId('pdf-page-retry')).toBeNull();
  });

  it('after a few tries asks for a tap, and a tap tries again', async () => {
    vi.useFakeTimers();
    const pdf = fakePdf(4);
    render(<PdfPage pdf={pdf} number={1} width={300} aspect={1.414} />);
    for (const wait of [0, 1000, 2000, 4000]) {
      await flush();
      await act(async () => void vi.advanceTimersByTime(wait));
    }
    await flush();
    expect(pdf.calls()).toBe(4);
    const retry = screen.getByTestId('pdf-page-retry');
    expect(retry).toHaveTextContent('Tap to try again');
    fireEvent.click(retry);
    await flush();
    expect(pdf.calls()).toBe(5);
    expect(pdf.rendered).toHaveBeenCalled();
    expect(screen.queryByTestId('pdf-page-retry')).toBeNull();
  });
});
