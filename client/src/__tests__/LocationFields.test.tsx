import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { EMPTY_LOCATION, LocationFields, locationCountry, locationFrom, locationPayload, validateLocation, type LocationValue } from '../components/member/LocationFields';

// Where a member lives is always asked the same way: country, region,
// division, subdivision, quarter.
function Form({ start = EMPTY_LOCATION, onValue }: { start?: LocationValue; onValue?: (v: LocationValue) => void }) {
  const [v, setV] = useState(start);
  onValue?.(v);
  return <LocationFields value={v} onChange={setV} idPrefix="t" />;
}

describe('Location fields', () => {
  it('asks country, region, division, subdivision and quarter, in that order', () => {
    render(<Form />);
    const labels = ['Country', 'Region', 'Division', 'Subdivision', 'Quarter'].map((l) => screen.getByLabelText(l));
    const all = Array.from(document.querySelectorAll('select, input'));
    expect(labels.map((el) => all.indexOf(el))).toEqual([0, 1, 2, 3, 4]);
    // For Cameroon the region is picked from the ten regions.
    expect((labels[1] as HTMLElement).tagName).toBe('SELECT');
  });

  it('writes every level in for another country, and for a country that is not on the list', () => {
    let latest = EMPTY_LOCATION;
    render(<Form onValue={(v) => (latest = v)} />);
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: '__other__' } });
    fireEvent.change(screen.getByLabelText('Type your country'), { target: { value: 'Rwanda' } });
    expect(screen.getByLabelText('Region').tagName).toBe('INPUT');
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'Kigali' } });
    fireEvent.change(screen.getByLabelText('Quarter'), { target: { value: 'Kimihurura' } });
    expect(locationCountry(latest)).toBe('Rwanda');
    expect(locationPayload(latest)).toEqual({ country: 'Rwanda', region: 'Kigali', quarter: 'Kimihurura' });
  });

  it('needs all four places for Cameroon, and only the region elsewhere', () => {
    expect(Object.keys(validateLocation(EMPTY_LOCATION, 'x')).sort()).toEqual(['division', 'quarter', 'region', 'subdivision']);
    const abroad = { ...EMPTY_LOCATION, countryChoice: 'France' };
    expect(Object.keys(validateLocation(abroad, 'x'))).toEqual(['region']);
    expect(validateLocation({ ...abroad, region: 'Île-de-France' }, 'x')).toEqual({});
  });

  it('starts from what was saved, putting an unlisted country under "Other"', () => {
    expect(locationFrom({ country: 'Gabon', region: 'Estuaire' })).toMatchObject({ countryChoice: 'Gabon', otherCountry: '', region: 'Estuaire' });
    expect(locationFrom({ country: 'Rwanda' })).toMatchObject({ countryChoice: '__other__', otherCountry: 'Rwanda' });
    expect(locationFrom({}).countryChoice).toBe('Cameroon');
  });
});
