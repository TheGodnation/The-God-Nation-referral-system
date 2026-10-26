import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Linkified, splitLinks } from '../lib/linkify';

const links = (text: string) => splitLinks(text).filter((p) => p.href).map((p) => [p.text, p.href]);

describe('linkify', () => {
  it('links https addresses, www addresses and bare site names', () => {
    expect(links('Open https://thegodnationacademy.org/notifications-guide/ now')).toEqual([
      ['https://thegodnationacademy.org/notifications-guide/', 'https://thegodnationacademy.org/notifications-guide/'],
    ]);
    expect(links('see www.example.com')).toEqual([['www.example.com', 'https://www.example.com']]);
    expect(links('go to thegodnationacademy.org')).toEqual([['thegodnationacademy.org', 'https://thegodnationacademy.org']]);
  });

  it('leaves out the punctuation that ends a sentence', () => {
    expect(links('Visit thegodnationacademy.org.')).toEqual([['thegodnationacademy.org', 'https://thegodnationacademy.org']]);
    expect(links('(https://example.com/a?b=1), thanks!')).toEqual([['https://example.com/a?b=1', 'https://example.com/a?b=1']]);
  });

  it('does not link email addresses, plain words or other schemes', () => {
    expect(links('write to grace@thegodnationacademy.org please')).toEqual([]);
    expect(links('e.g. this and i.e. that, version 1.5')).toEqual([]);
    expect(links('javascript:alert(1) and ftp://x.org')).toEqual([]);
  });

  it('renders links that open in a new tab and keeps the other text', () => {
    render(<p>Read <Linkified text="the guide at https://thegodnationacademy.org/x today" /></p>);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', 'https://thegodnationacademy.org/x');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a.closest('p')).toHaveTextContent('Read the guide at https://thegodnationacademy.org/x today');
  });
});
