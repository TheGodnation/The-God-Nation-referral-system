import { describe, expect, it } from 'vitest';
import { certificateFileName, issuedLine, numberLine, templateUrl } from '../lib/certificateRender';

// The words written on the diploma: the date of issue and the number, in English and French (the design itself is a picture).
describe('Certificate wording', () => {
  it('writes the English date like the design: "Issued on this 30th of October, 2026"', () => {
    expect(issuedLine('2026-10-30T10:00:00Z', 'en')).toBe('Issued on this 30th of October, 2026');
    expect(issuedLine('2026-11-01T10:00:00Z', 'en')).toBe('Issued on this 1st of November, 2026');
    expect(issuedLine('2026-11-02T10:00:00Z', 'en')).toBe('Issued on this 2nd of November, 2026');
    expect(issuedLine('2026-11-03T10:00:00Z', 'en')).toBe('Issued on this 3rd of November, 2026');
    expect(issuedLine('2026-11-11T10:00:00Z', 'en')).toBe('Issued on this 11th of November, 2026');
    expect(issuedLine('2026-11-22T10:00:00Z', 'en')).toBe('Issued on this 22nd of November, 2026');
  });

  it('writes the French date like the design: "Délivré le 30 octobre 2026", with "1er"', () => {
    expect(issuedLine('2026-10-30T10:00:00Z', 'fr')).toBe('Délivré le 30 octobre 2026');
    expect(issuedLine('2026-02-01T10:00:00Z', 'fr')).toBe('Délivré le 1er février 2026');
    expect(issuedLine('2026-12-25T10:00:00Z', 'fr')).toBe('Délivré le 25 décembre 2026');
  });

  it('uses the date in Cameroon whatever the device clock says (just after midnight there is already the next day)', () => {
    // 23:30 UTC on the 30th is 00:30 on the 31st in Cameroon (UTC+1).
    expect(issuedLine('2026-10-30T23:30:00Z', 'en')).toBe('Issued on this 31st of October, 2026');
  });

  it('writes the number line in both languages', () => {
    expect(numberLine('GNLA-2026-001', 'en')).toBe('Certificate No.: GNLA-2026-001');
    expect(numberLine('GNLA-2026-001', 'fr')).toBe('Certificat N° : GNLA-2026-001');
  });

  it('names the saved file after the number and the student, without accents or odd characters', () => {
    expect(certificateFileName({ number: 'GNLA-2026-001', name: 'Marie-Thérèse Ngo Bassong' })).toBe('GNLA-2026-001-marie-therese-ngo-bassong.png');
    expect(certificateFileName({ number: 'GNLA-2026-002', name: '   ' })).toBe('GNLA-2026-002.png');
  });

  it('has a blank design for each language', () => {
    expect(templateUrl('en')).toMatch(/^\/certificate\/blank-en\.png\?v=\d+$/);
    expect(templateUrl('fr')).toMatch(/^\/certificate\/blank-fr\.png\?v=\d+$/);
  });
});
