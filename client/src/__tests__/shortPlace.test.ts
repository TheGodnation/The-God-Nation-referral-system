import { describe, it, expect } from 'vitest';
import { shortPlace } from '../lib/shortPlace';

describe('shortPlace', () => {
  it('writes a quarter with its subdivision and division, so people know where it is', () => {
    expect(shortPlace('QUARTER', 'Bepanda, Douala V, Wouri, Littoral, Cameroon')).toBe('Bepanda, Douala V, Wouri');
  });
  it('writes a subdivision with its division, a division with its region, a region alone', () => {
    expect(shortPlace('SUBDIVISION', 'Douala V, Wouri, Littoral, Cameroon')).toBe('Douala V, Wouri');
    expect(shortPlace('DIVISION', 'Wouri, Littoral, Cameroon')).toBe('Wouri, Littoral');
    expect(shortPlace('REGION', 'Littoral, Cameroon')).toBe('Littoral');
  });
  it('copes with short paths', () => {
    expect(shortPlace('QUARTER', 'Bepanda')).toBe('Bepanda');
  });
});
