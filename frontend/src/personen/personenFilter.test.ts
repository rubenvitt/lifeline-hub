import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import {
  SICHT_VORGABE,
  filterPersonen,
  gefundenePersonen,
  sichtFuerNeuePerson,
  sichtNachSprung,
} from './personenFilter';

/**
 * Die Filterkette der Personenliste als reine Funktionen (Muster
 * `pages/schaeden/schadenHelfer.tsx`) — prüfbar ohne Rendern, damit die Sicht-Semantik nicht
 * an einer Tabellendarstellung hängt.
 */

const basis: Person = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 11:22:00',
  geaendert_von: 1,
  storniert_at: null,
};

const vermisst: Person = { ...basis, id: 11, registrier_nr: 2, status: 'vermisst' };
const betroffen: Person = { ...basis, id: 12, registrier_nr: 3, status: 'betroffen' };
const verstorben: Person = { ...basis, id: 13, registrier_nr: 4, status: 'verstorben' };
const betroffenStorniert: Person = {
  ...basis,
  id: 14,
  registrier_nr: 5,
  status: 'betroffen',
  storniert_at: '2026-05-27 10:00:00',
};
const patient: Person = {
  ...basis,
  id: 15,
  registrier_nr: 6,
  status: 'betroffen',
  aktuelle_sichtung: 'sk2',
  aktuelle_sichtung_at: '2026-05-27 09:30:00',
};

const alle = [basis, vermisst, betroffen, verstorben, betroffenStorniert, patient];
const nummern = (p: readonly Person[]) => p.map((x) => x.registrier_nr);

const SICHT = { ansicht: 'zeilen', filter: 'alle', nurLuecken: false } as const;

describe('filterPersonen', () => {
  it('„alle" filtert nichts weg und behält die Lieferreihenfolge', () => {
    expect(filterPersonen(alle, SICHT)).toEqual(alle);
  });

  it('filtert nach Sichtung NICHT — das Raster gruppiert, es filtert nicht', () => {
    expect(filterPersonen(alle, { ...SICHT, ansicht: 'raster' })).toEqual(alle);
  });

  it('filtert jeden Statusfilter auf genau seinen Status', () => {
    expect(nummern(filterPersonen(alle, { ...SICHT, filter: 'vermisst' }))).toEqual([2]);
    expect(nummern(filterPersonen(alle, { ...SICHT, filter: 'erfasst' }))).toEqual([1]);
    expect(nummern(filterPersonen(alle, { ...SICHT, filter: 'verstorben' }))).toEqual([4]);
    // betroffen: der Stornierte und der Patient tragen denselben Status — der Statusfilter
    // blendet KEINEN von beiden aus (das tut nur `gefundenePersonen`).
    expect(nummern(filterPersonen(alle, { ...SICHT, filter: 'betroffen' }))).toEqual([3, 5, 6]);
  });

  it('„Nur Lücken" zeigt genau die Datensätze mit offenem Feld — und wirkt MIT dem Filter', () => {
    const offen = { ...betroffen, id: 20, registrier_nr: 20, aktueller_verbleib: null };
    const vermisstOhneAlles = { ...vermisst, antreff_ort: null, aktueller_verbleib: null };
    const menge = [{ ...basis, aktueller_verbleib: 'entlassen' }, offen, vermisstOhneAlles];
    expect(nummern(filterPersonen(menge, { ...SICHT, nurLuecken: true }))).toEqual([20]);
    expect(filterPersonen(menge, { ...SICHT, filter: 'erfasst', nurLuecken: true })).toEqual([]);
  });
});

describe('sichtFuerNeuePerson', () => {
  it('lässt eine passende Sicht unangetastet (dieselbe Referenz)', () => {
    const sicht = { ...SICHT, filter: 'betroffen' } as const;
    expect(sichtFuerNeuePerson(sicht, betroffen)).toBe(sicht);
  });

  it('nimmt einen verbergenden Statusfilter auf „Alle" zurück, die Ansicht bleibt', () => {
    expect(
      sichtFuerNeuePerson({ ansicht: 'raster', filter: 'vermisst', nurLuecken: false }, patient),
    ).toEqual({ ansicht: 'raster', filter: 'alle', nurLuecken: false });
  });

  it('nimmt „Nur Lücken" nur zurück, wenn die neue Person keine Lücke hat', () => {
    const mitLuecke = { ...betroffen, aktueller_verbleib: null };
    const ohneLuecke = { ...betroffen, aktueller_verbleib: 'entlassen' };
    expect(sichtFuerNeuePerson({ ...SICHT, nurLuecken: true }, mitLuecke).nurLuecken).toBe(true);
    expect(sichtFuerNeuePerson({ ...SICHT, nurLuecken: true }, ohneLuecke).nurLuecken).toBe(false);
  });
});

describe('gefundenePersonen', () => {
  it('nimmt betroffen UND verstorben', () => {
    expect(nummern(gefundenePersonen([basis, betroffen, verstorben]))).toEqual([3, 4]);
  });

  it('schließt Stornierte aus', () => {
    // Der Fall, der bei einem vergessenen `!storniert_at` durchfällt.
    expect(nummern(gefundenePersonen(alle))).not.toContain(5);
    expect(nummern(gefundenePersonen(alle))).toEqual([3, 4, 6]);
  });

  it('lässt erfasst und vermisst draußen', () => {
    expect(nummern(gefundenePersonen([basis, vermisst]))).toEqual([]);
  });
});

describe('sichtNachSprung (LFH-620)', () => {
  const vorher = { ansicht: 'raster', filter: 'betroffen', nurLuecken: true } as const;

  it('übernimmt nur die genannten Achsen und nimmt den Lücken-Filter immer zurück', () => {
    expect(sichtNachSprung(vorher, { filter: 'vermisst' })).toEqual({
      ansicht: 'raster',
      filter: 'vermisst',
      nurLuecken: false,
    });
    expect(sichtNachSprung(vorher, { ansicht: 'zeilen', filter: 'alle' })).toEqual({
      ansicht: 'zeilen',
      filter: 'alle',
      nurLuecken: false,
    });
  });

  it('lässt die Sicht ohne Vorgabe unverändert, samt Identität', () => {
    expect(sichtNachSprung(vorher, {})).toBe(vorher);
    expect(sichtNachSprung(SICHT_VORGABE, {})).toBe(SICHT_VORGABE);
  });
});
