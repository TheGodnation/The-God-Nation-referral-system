import { describe, it, expect } from 'vitest';
import { otherFees } from '../lib/bookPrice';

describe('book price: the 200 FCFA for other fees', () => {
  it('is whatever is above the 1,000 FCFA for the book', () => {
    expect(otherFees(1200)).toBe(200);
    expect(otherFees(1100)).toBe(100);
  });
  it('is nothing at or below 1,000 FCFA, so no wrong note is ever shown', () => {
    expect(otherFees(1000)).toBe(0);
    expect(otherFees(800)).toBe(0);
  });
});
