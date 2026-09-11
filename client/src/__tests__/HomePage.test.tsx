import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';

describe('HomePage', () => {
  it('renders the hero and both required pathways, with no referral trace', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('BE EQUIPPED. BE TRANSFORMED. BE SENT.')).toBeInTheDocument();

    // Both pathways, Training first — exact required headings/CTAs.
    expect(screen.getByText('BE EQUIPPED & SENT')).toBeInTheDocument();
    expect(screen.getByText('BEGIN YOUR TRAINING JOURNEY')).toBeInTheDocument();
    expect(screen.getByText('DISCOVER & GROW')).toBeInTheDocument();
    expect(screen.getByText('JOIN OUR SPIRITUAL COMMUNITY')).toBeInTheDocument();

    // Section 15: never gate on identity.
    expect(screen.queryByText(/are you born again/i)).not.toBeInTheDocument();

    // Must not expose internal referral commission mechanics publicly.
    expect(screen.queryByText(/500 FCFA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();

    // Section 8: never reveal who referred the visitor.
    expect(screen.queryByText(/invited by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/referred by/i)).not.toBeInTheDocument();
  });
});
