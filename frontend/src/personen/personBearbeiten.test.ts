import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import { bearbeitenWerteAus, bearbeitenZuPatch, verortenLinkStil } from './personBearbeiten';

const basis = {
  name: 'Mustermann',
  vorname: null,
  geschlecht: null,
  geburtsdatum: null,
  alter_geschaetzt: null,
  herkunft_adresse: null,
  antreff_ort: null,
  melder_kontakt: null,
  notiz: null,
  status: 'betroffen',
} satisfies Partial<Person>;

describe('bearbeitenWerteAus / bearbeitenZuPatch (LFH-613)', () => {
  it('schreibt die Koordinate als Text und lässt „vermisst seit" außerhalb von vermisst weg', () => {
    const w = bearbeitenWerteAus({
      ...basis,
      antreff_lat: 52.2691,
      antreff_lon: 9.1342,
      vermisst_seit: '2026-09-22 06:00:00',
    });
    expect(w.koordinate).toBe('52.2691/9.1342');
    expect(w).not.toHaveProperty('vermisst_seit');
  });

  it('sendet das Paar nur bei geändertem Text', () => {
    const anfang = bearbeitenWerteAus({ ...basis, antreff_lat: 52.269149, antreff_lon: 9.1 });
    expect(bearbeitenZuPatch(anfang, anfang, false)).not.toHaveProperty('antreff_lat');
    expect(bearbeitenZuPatch({ ...anfang, koordinate: '-1/2' }, anfang, false)).toMatchObject({
      antreff_lat: -1,
      antreff_lon: 2,
    });
    expect(bearbeitenZuPatch({ ...anfang, koordinate: ' ' }, anfang, false)).toMatchObject({
      antreff_lat: null,
      antreff_lon: null,
    });
  });

  it('sendet „vermisst seit" nur bei vermisst und nur geändert — nie als null', () => {
    const anfang = bearbeitenWerteAus({
      ...basis,
      status: 'vermisst',
      vermisst_seit: '2026-09-22 06:00:00',
    });
    expect(anfang.vermisst_seit).toBe('2026-09-22 06:00:00');
    expect(bearbeitenZuPatch(anfang, anfang, true)).not.toHaveProperty('vermisst_seit');
    expect(
      bearbeitenZuPatch({ ...anfang, vermisst_seit: undefined }, anfang, true),
    ).not.toHaveProperty('vermisst_seit');
    const neu = { ...anfang, vermisst_seit: '2026-09-22 05:00:00' };
    expect(bearbeitenZuPatch(neu, anfang, true)).toMatchObject({
      vermisst_seit: '2026-09-22 05:00:00',
    });
    expect(bearbeitenZuPatch(neu, anfang, false)).not.toHaveProperty('vermisst_seit');
  });
});

describe('verortenLinkStil', () => {
  it('trägt beide Angaben des handgebauten Bedienziels und folgt der Dichtestufe', () => {
    // Literale Böden (LFH-365): kompakt 30, Handschuh 72.
    expect(verortenLinkStil({ controlHeight: 30, paddingSM: 12 })).toMatchObject({
      minHeight: 30,
      paddingInline: 12,
    });
    expect(verortenLinkStil({ controlHeight: 72, paddingSM: 12 }).minHeight).toBe(72);
  });
});
