import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { LiveFormatTextarea } from '../components/LiveFormatTextarea';
import { renderLive } from '../lib/liveFormat';

// The writing box shows formatting as you type, like WhatsApp: the same text
// underneath (symbols included), painted with bold / italic / crossed-out words.

function paint(text: string) {
  const { container } = render(<div>{renderLive(text)}</div>);
  return container;
}

describe('Live formatting in the writing box', () => {
  it('keeps every character (symbols included) so the painted copy lines up with the real text', () => {
    for (const text of ['*GREETINGS EVERYONE*\n\nYesterday, we _distributed_ keys ~by mistake~.', '- one\n1. two\n> three\n# four', '5 * 3 * 2 and snake_case_name', '*unclosed bold', 'a *b* c\n']) {
      expect(paint(text).textContent?.replace(/​/g, '')).toBe(text);
    }
  });

  it('shows words in stars as bold with the stars faint, italics leaning, tildes crossed out', () => {
    const box = paint('*Bold words* and _lean in_ and ~gone~');
    expect(box.querySelector('.lf-b')?.textContent).toBe('Bold words');
    expect(Array.from(box.querySelectorAll('.lf-mark')).map((m) => m.textContent)).toEqual(['*', '*', '_', '_', '~', '~']);
    expect(Array.from(box.querySelectorAll('.lf-i')).map((m) => m.textContent)).toEqual(['lean', 'in']);
    expect(box.querySelector('.lf-s')?.textContent).toBe('gone');
  });

  it('only counts symbols that hug the words, never a sum or a snake_case_name', () => {
    const box = paint('5 * 3 * 2 and snake_case_name');
    expect(box.querySelector('.lf-b, .lf-i')).toBeNull();
  });

  it('paints a heading line and a list or quote line prefix', () => {
    const box = paint('# Title\n- item\n> said');
    expect(box.querySelector('.lf-h')?.textContent).toBe('Title');
    expect(box.querySelector('.lf-quote')?.textContent).toBe('said');
    expect(Array.from(box.querySelectorAll('.lf-mark')).map((m) => m.textContent)).toEqual(['# ', '- ', '> ']);
  });

  it('is still a normal textarea: typing changes the text and the painted copy follows', () => {
    function Box() {
      const [v, setV] = useState('');
      return <LiveFormatTextarea aria-label="Write" value={v} onChange={(e) => setV(e.target.value)} className="p-2" />;
    }
    render(<Box />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Write' }), { target: { value: 'Hello *you*' } });
    expect(screen.getByRole('textbox', { name: 'Write' })).toHaveValue('Hello *you*');
    expect(screen.getByTestId('live-format-mirror').querySelector('.lf-b')?.textContent).toBe('you');
    // The painted copy is hidden from screen readers.
    expect(screen.getByTestId('live-format-mirror')).toHaveAttribute('aria-hidden', 'true');
  });
});
