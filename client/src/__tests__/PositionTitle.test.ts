import { describe, it, expect } from 'vitest';
import { localPositionTitle } from '../lib/positionTitle';

describe('representative titles in French', () => {
  it('shows the standard titles in French for a French reader', () => {
    expect(localPositionTitle('Quarter Representative', 'fr')).toBe('Représentant de quartier');
    expect(localPositionTitle('Second Assistant Subdivision Representative', 'fr-FR')).toBe('Deuxième représentant adjoint d’arrondissement');
  });
  it('keeps English for English readers, and an admin-written title as written', () => {
    expect(localPositionTitle('Quarter Representative', 'en')).toBe('Quarter Representative');
    expect(localPositionTitle('Coordinator of Youth Media', 'fr')).toBe('Coordinator of Youth Media');
    expect(localPositionTitle(null, 'fr')).toBe('');
  });
});
