import { describe, expect, it } from 'vitest';
import type { Tier } from '../../api/types';
import { filterTiere, halterVorbelegung, verbleibText } from './tierHelfer';

/** Filterkette der Tierliste als reine Funktion (Muster `pages/schaeden/schadenHelfer.tsx`). */

const basis: Tier = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'aktiv',
  spezies: 'hund',
  rasse_beschreibung: 'Schäferhund',
  rufname: 'Rex',
  geschlecht: 'maennlich',
  alter_geschaetzt: 3,
  farbe_beschreibung: null,
  kennzeichnung: null,
  groesse_gewicht: null,
  halter_person_id: null,
  halter_kontakt: null,
  antreff_ort: 'Weide',
  notiz: null,
  abschluss_grund: null,
  abschluss_ziel: null,
  erfasst_at: '2026-05-29 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-29 11:22:00',
  geaendert_von: 1,
  storniert_at: null,
  halter_registrier_nr: null,
  halter_storniert_at: null,
};

const katzeAktiv: Tier = { ...basis, id: 11, registrier_nr: 2, spezies: 'katze', rufname: 'Mimi' };
const katzeVermisst: Tier = {
  ...basis,
  id: 12,
  registrier_nr: 3,
  spezies: 'katze',
  status: 'vermisst',
  rufname: 'Felix',
};
const hundVermisst: Tier = { ...basis, id: 13, registrier_nr: 4, status: 'vermisst' };

const alle = [basis, katzeAktiv, katzeVermisst, hundVermisst];
const nummern = (t: readonly Tier[]) => t.map((x) => x.registrier_nr);

describe('filterTiere', () => {
  it('„alle" ohne Spezies filtert nichts weg und behält die Lieferreihenfolge', () => {
    expect(filterTiere(alle, { sicht: 'alle', spezies: undefined })).toEqual(alle);
  });

  it('filtert allein nach Status', () => {
    expect(nummern(filterTiere(alle, { sicht: 'vermisst', spezies: undefined }))).toEqual([3, 4]);
  });

  it('filtert allein nach Spezies', () => {
    expect(nummern(filterTiere(alle, { sicht: 'alle', spezies: 'katze' }))).toEqual([2, 3]);
  });

  it('verbindet Status und Spezies als Schnittmenge, nicht als Vereinigung', () => {
    // Bei `||` statt `&&` ergäbe sich die Vereinigung [2, 3, 4] statt der Schnittmenge [3].
    expect(nummern(filterTiere(alle, { sicht: 'vermisst', spezies: 'katze' }))).toEqual([3]);
  });

  it('liefert eine leere Menge, wenn die Schnittmenge leer ist', () => {
    expect(filterTiere(alle, { sicht: 'abgeschlossen', spezies: 'katze' })).toEqual([]);
  });
});

/** LLH-1092: der Verbleib ist der zweite Blick der Liste — ohne Klick lesbar, nur am abgeschlossenen Tier. */
describe('verbleibText', () => {
  const abgeschlossen: Tier = { ...basis, status: 'abgeschlossen', abschluss_grund: 'verstorben' };

  it('nennt den Verbleib in Handlungsform', () => {
    expect(verbleibText(abgeschlossen)).toBe('verstorben');
    expect(verbleibText({ ...abgeschlossen, abschluss_grund: 'freilauf' })).toBe('freigelassen');
  });

  it('hängt das Ziel an, wenn es erfasst ist', () => {
    expect(
      verbleibText({
        ...abgeschlossen,
        abschluss_grund: 'uebergabe_tierarzt',
        abschluss_ziel: 'Dr. Müller',
      }),
    ).toBe('an Tierarzt übergeben: Dr. Müller');
  });

  it('ist leer an einem wieder aufgenommenen Tier, auch wenn der alte Grund gespeichert bleibt', () => {
    expect(verbleibText({ ...abgeschlossen, status: 'aktiv' })).toBeNull();
    expect(verbleibText(basis)).toBeNull();
  });
});

describe('halterVorbelegung', () => {
  it('nimmt die Registriernummer der Halterperson, sonst den Kontakt, sonst nichts', () => {
    expect(halterVorbelegung({ ...basis, halter_registrier_nr: 7, halter_kontakt: null })).toBe(
      'R-007',
    );
    expect(halterVorbelegung({ ...basis, halter_kontakt: 'Fam. Becker, 0171 …' })).toBe(
      'Fam. Becker, 0171 …',
    );
    expect(halterVorbelegung(basis)).toBeNull();
  });

  it('nimmt keine stornierte Halterperson, dann den Kontakt', () => {
    expect(
      halterVorbelegung({
        ...basis,
        halter_registrier_nr: 7,
        halter_storniert_at: '2026-05-29 10:00:00',
      }),
    ).toBeNull();
  });
});
