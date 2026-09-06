import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';

describe('HomePage', () => {
  it('renders the required hero copy and primary CTA', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('BE EQUIPPED. BE TRANSFORMED. BE SENT.')).toBeInTheDocument();
    expect(screen.getAllByText('REGISTER IN LESS THAN 1 MINUTE').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Complete your registration and you'll be directed straight to our official WhatsApp Training Community.",
      ),
    ).toBeInTheDocument();

    // Must not expose internal referral commission mechanics publicly.
    expect(screen.queryByText(/500 FCFA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();
  });
});
