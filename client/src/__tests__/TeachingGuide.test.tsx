import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n';
import { MemberTeachingGuidePage } from '../pages/MemberTeachingGuidePage';

// The simple guide inside the app for the weekly teachers.
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('the teaching guide', () => {
  it('says to record in short pieces of about 5 minutes, never 15 in one go', () => {
    render(<MemoryRouter><MemberTeachingGuidePage /></MemoryRouter>);
    const pieces = screen.getByTestId('guide-pieces');
    expect(within(pieces).getByText(/short pieces of 5 minutes/i)).toBeInTheDocument();
    expect(pieces).toHaveTextContent('Do not record 15 minutes from beginning to end');
    expect(pieces).toHaveTextContent('too big for the app to write down and translate');
  });

  it('says recording ahead is only for before the time, and that when the time has come you go live', () => {
    render(<MemoryRouter><MemberTeachingGuidePage /></MemoryRouter>);
    expect(screen.getByTestId('guide-way2')).toHaveTextContent('only record ahead before your teaching time');
    expect(screen.getByTestId('guide-way2')).toHaveTextContent('Just go live (Way 1)');
    expect(screen.getByTestId('guide-way1')).toHaveTextContent('When your time is ready, you just go live');
    expect(screen.getByTestId('guide-choose')).toHaveTextContent('Pick only one');
  });

  it('says the rating card appears by itself 25 minutes after the time starts', () => {
    render(<MemoryRouter><MemberTeachingGuidePage /></MemoryRouter>);
    expect(screen.getByTestId('guide-way1')).toHaveTextContent('25 minutes');
    expect(screen.getByTestId('teaching-guide')).not.toHaveTextContent('20 minutes');
  });

  it('is in French too, with the same button names as the app', async () => {
    await i18n.changeLanguage('fr');
    render(<MemoryRouter><MemberTeachingGuidePage /></MemoryRouter>);
    expect(screen.getByTestId('guide-pieces')).toHaveTextContent('petits morceaux de 5 minutes');
    expect(screen.getByTestId('guide-way1')).toHaveTextContent("J'ai terminé mon enseignement");
    expect(screen.getByTestId('guide-way1')).toHaveTextContent('25 minutes');
    expect(screen.getByTestId('guide-way2')).toHaveTextContent('Ajouter à mon enseignement');
  });
});
