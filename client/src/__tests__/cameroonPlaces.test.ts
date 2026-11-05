import { describe, it, expect } from 'vitest';
import { CAMEROON_PLACE_COUNTS, divisionsOf, quartersOf, subdivisionsOf } from '../lib/cameroonPlaces';
import { CAMEROON_REGIONS } from '../lib/locations';

describe('Cameroon places', () => {
  it('has the ten regions and the 58 divisions, each region by the same name as the region list', () => {
    expect(CAMEROON_PLACE_COUNTS.regions).toBe(10);
    expect(CAMEROON_PLACE_COUNTS.divisions).toBe(58);
    for (const r of CAMEROON_REGIONS) expect(divisionsOf(r.value).length, r.value).toBeGreaterThan(0);
  });

  it('has no place listed twice in the same division, and every division has subdivisions', () => {
    for (const r of CAMEROON_REGIONS) {
      for (const d of divisionsOf(r.value)) {
        expect(d.subdivisions.length, `${r.value} > ${d.name}`).toBeGreaterThan(0);
        expect(new Set(d.subdivisions).size, `${r.value} > ${d.name}`).toBe(d.subdivisions.length);
      }
    }
  });

  it('finds a division\'s subdivisions and a town\'s quarters', () => {
    expect(subdivisionsOf('South-West', 'Fako')).toContain('Buea');
    expect(subdivisionsOf('Littoral', 'Wouri')).toEqual(['Douala I', 'Douala II', 'Douala III', 'Douala IV', 'Douala V', 'Douala VI', 'Manoka']);
    expect(subdivisionsOf('Centre', 'Mfoundi')).toHaveLength(7);
    expect(quartersOf('Buea')).toContain('Molyko');
    expect(quartersOf('Tibati')).toEqual([]); // no list: typed
  });

  it('lists 360 subdivisions in all', () => {
    expect(CAMEROON_PLACE_COUNTS.subdivisions).toBe(360);
  });
});
