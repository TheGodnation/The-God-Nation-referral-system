import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

  it('finds bare addresses at the start of the text, after a new line, and side by side', () => {
    expect(links('thegodnationacademy.org')).toEqual([['thegodnationacademy.org', 'https://thegodnationacademy.org']]);
    expect(links('first line\nthegodnationacademy.org/learn rest')).toEqual([['thegodnationacademy.org/learn', 'https://thegodnationacademy.org/learn']]);
    expect(links('a.org b.com')).toEqual([
      ['a.org', 'https://a.org'],
      ['b.com', 'https://b.com'],
    ]);
    // The character before the address stays in the text, so nothing is lost.
    const rebuilt = splitLinks('see (x.org) and a@b.org too').map((p) => p.text).join('');
    expect(rebuilt).toBe('see (x.org) and a@b.org too');
    expect(links('see (x.org) and a@b.org too')).toEqual([['x.org', 'https://x.org']]);
  });
});

// Older iPhones (iOS before 16.4) cannot create a regular expression with a
// "lookbehind" — (?<=…) or (?<!…). One of those in the chat text code made every
// screen that shows chat messages fail on an iPhone 8. Keep them out of the app.
describe('the app code avoids what older iPhones cannot run', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== '__tests__' && name !== 'node_modules') walk(path);
      } else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk(join(__dirname, '..'));

  it('has no regular expression lookbehind', () => {
    const offenders = files.filter((f) => /\(\?<[=!]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
