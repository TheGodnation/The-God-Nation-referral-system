import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComfortReader } from '../components/ComfortReader';
import { RichText } from '../lib/richText';

// "Read in comfort": a long text on its own screen, in big type, with
// headings set apart from the paragraphs, and A− / A+ that is remembered.
afterEach(() => {
  localStorage.clear();
});

const TEXT = '# Faith first\n\nWe walk by faith.\n\nIt is not by sight.\n\n# Then prayer\n\nPray without ceasing.';

describe('Read in comfort', () => {
  it('shows headings as headings and each paragraph apart', () => {
    render(<ComfortReader title="Evangelist Stanley" text={TEXT} onClose={() => {}} />);
    const reader = screen.getByTestId('comfort-reader');
    expect(reader).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Faith first').className).toContain('font-bold');
    expect(screen.getByText('We walk by faith.').tagName).toBe('P');
    expect(screen.getByText('Then prayer').className).toContain('mt-7');
    expect(screen.getByText('Evangelist Stanley')).toBeInTheDocument();
  });

  it('A+ makes the text bigger and remembers it; Close and Escape leave', () => {
    const onClose = vi.fn();
    const { unmount } = render(<ComfortReader title="x" text="Hello" onClose={onClose} />);
    const box = () => screen.getByTestId('comfort-text').parentElement as HTMLElement;
    expect(box().style.fontSize).toBe('18px');
    fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
    expect(box().style.fontSize).toBe('20px');
    unmount();
    render(<ComfortReader title="x" text="Hello" onClose={onClose} />);
    expect(box().style.fontSize).toBe('20px');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the tight spacing in the chat, roomy spacing only when asked', () => {
    const { container, rerender } = render(<RichText text={'one\n\n# Head\n\ntwo'} headings />);
    expect(container.querySelectorAll('p')[2].className).toContain('mt-1');
    rerender(<RichText text={'one\n\n# Head\n\ntwo'} headings comfort />);
    expect(container.querySelectorAll('p')[2].className).toContain('mt-4');
  });
});
