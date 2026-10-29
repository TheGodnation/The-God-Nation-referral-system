import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import i18n from '../i18n';
import { BookCover } from '../components/learn/BookCover';

// A book can have its own French cover; French readers see it, everyone else
// (and French readers of a book without one) see the English cover.
afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('BookCover languages', () => {
  it('shows the English cover in English and the French cover in French', async () => {
    const { container } = render(<BookCover number={1} title="Called" coverUrl="/en.jpg" coverUrlFr="/fr.jpg" />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/en.jpg');
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(container.querySelector('img')).toHaveAttribute('src', '/fr.jpg');
  });

  it('French readers get the English cover when the book has no French one', async () => {
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    const { container } = render(<BookCover number={1} title="Appelé" coverUrl="/en.jpg" coverUrlFr={null} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/en.jpg');
    expect(screen.queryByRole('img', { name: /Couverture du livre 1/ })).toBeInTheDocument();
  });
});
