import { describe, expect, it } from 'vitest';
import { prepareIntro, splitIntro } from '../lib/curriculumText';

const opts = { store: false, books: 16, levels: 3, price: 1200 };

describe('curriculum intro text', () => {
  it('fills in the numbers and the price', () => {
    const out = prepareIntro('{{books}} books in {{levels}} levels. {{price}} FCFA', opts);
    expect(out).toBe('16 books in 3 levels. 1 200 FCFA');
  });
  it('keeps website-only lines on the website and drops them in the Play version', () => {
    const text = 'Hello\n@web The price is {{price}} FCFA.\nBye';
    expect(prepareIntro(text, opts)).toContain('The price is');
    expect(prepareIntro(text, opts)).not.toContain('@web');
    const store = prepareIntro(text, { ...opts, store: true });
    expect(store).not.toContain('price');
    expect(store).toContain('Hello');
    expect(store).toContain('Bye');
  });
  it('splits at the books marker', () => {
    expect(splitIntro('One\n\n[[books]]\n\nTwo')).toEqual({ before: 'One', after: 'Two' });
    expect(splitIntro('Only')).toEqual({ before: 'Only', after: '' });
  });
});
