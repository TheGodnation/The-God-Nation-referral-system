// A leadership book costs 1,200 FCFA: 1,000 FCFA for the book and 200 FCFA
// for other fees. Only the part above the base is called "other fees", so the
// note disappears (and never shows a wrong number) if the price is changed to
// 1,000 or less.
export const BOOK_BASE_FCFA = 1000;
export const otherFees = (price: number) => Math.max(0, price - BOOK_BASE_FCFA);
