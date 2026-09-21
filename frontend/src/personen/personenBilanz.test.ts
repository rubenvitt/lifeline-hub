import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import {
  hatLuecke,
  istAngetroffen,
  lueckenText,
  lueckenVon,
  offeneFelder,
  sichtungsbild,
  verbleibArtAus,
  verbleibKlasse,
  verbleibZaehlung,
} from './personenBilanz';

/** Die Zählungen der Seitenleiste — ohne Rendern, gegen handgezählte Literale. */

const basis: Person = {
  id: 1,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'betroffen',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  aktueller_verbleib: 'Transport → KH Mitte',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
};
let n = 1;
const p = (extra: Partial<Person>): Person => ({ ...basis, id: ++n, registrier_nr: n, ...extra });

describe('verbleibArtAus — die vier Backend-Kurzformen (src/person/mod.rs)', () => {
  it.each([
    ['Transport → KH Mitte', 'transport'],
    ['Transport', 'transport'],
    ['entlassen', 'entlassen'],
    ['vor Ort', 'vor_ort'],
    ['verstorben', 'verstorben'],
  ])('„%s" → %s', (kurzform, art) => {
    expect(verbleibArtAus(kurzform)).toBe(art);
  });

  it('fällt bei fremdem Text auf „sonstig", nicht still in eine Art', () => {
    expect(verbleibArtAus('Transporter')).toBe('sonstig');
    expect(verbleibArtAus('Notunterkunft Ost')).toBe('sonstig');
  });
});

describe('Lücken', () => {
  it('kennt nur angetroffene Personen als lückenfähig', () => {
    expect(
      ['erfasst', 'betroffen', 'verstorben'].map((s) =>
        istAngetroffen({ status: s as Person['status'] }),
      ),
    ).toEqual([true, true, true]);
    expect(istAngetroffen({ status: 'vermisst' })).toBe(false);
    expect(istAngetroffen({ status: 'abgemeldet' })).toBe(false);
  });

  it('meldet fehlenden Verbleib und fehlenden Fundort getrennt', () => {
    expect(lueckenVon(p({ aktueller_verbleib: null }))).toEqual({ verbleib: true, fundort: false });
    expect(lueckenVon(p({ antreff_ort: '  ' }))).toEqual({ verbleib: false, fundort: true });
  });

  it('zählt eine Person in einer UHS nicht als „Verbleib offen"', () => {
    expect(lueckenVon(p({ aktueller_verbleib: null, aktuelle_uhs_id: 7 })).verbleib).toBe(false);
  });

  it('führt eine vermisste Person ohne Fundort und Verbleib NICHT als Lücke', () => {
    const vermisst = p({ status: 'vermisst', antreff_ort: null, aktueller_verbleib: null });
    expect(hatLuecke(vermisst)).toBe(false);
  });

  it('schreibt den zweiten Kanal aus', () => {
    expect(lueckenText({ verbleib: true, fundort: true })).toBe('Verbleib, Fundort offen');
    expect(lueckenText({ verbleib: false, fundort: true })).toBe('Fundort offen');
    expect(lueckenText({ verbleib: false, fundort: false })).toBeNull();
  });
});

describe('offeneFelder', () => {
  it('zählt je Feld und je Datensatz', () => {
    const alle = [
      p({}),
      p({ aktueller_verbleib: null }),
      p({ aktueller_verbleib: null, antreff_ort: null }),
      p({ antreff_ort: null }),
      p({ status: 'vermisst', aktueller_verbleib: null, antreff_ort: null }),
    ];
    expect(offeneFelder(alle)).toEqual({ ohneVerbleib: 2, ohneFundort: 2, datensaetze: 3 });
  });
});

describe('verbleibKlasse / verbleibZaehlung', () => {
  it('leitet die Klasse aus Kurzform, dann UHS, sonst offen ab', () => {
    expect(verbleibKlasse({ aktueller_verbleib: 'entlassen', aktuelle_uhs_id: 7 })).toBe(
      'entlassen',
    );
    expect(verbleibKlasse({ aktueller_verbleib: null, aktuelle_uhs_id: 7 })).toBe('uhs');
    expect(verbleibKlasse({ aktueller_verbleib: null, aktuelle_uhs_id: null })).toBe('offen');
  });

  it('zählt je Art und je UHS, „offen" zuletzt und immer', () => {
    const alle = [
      p({}),
      p({ aktueller_verbleib: 'Transport' }),
      p({ aktueller_verbleib: 'vor Ort' }),
      p({ aktueller_verbleib: null, aktuelle_uhs_id: 7 }),
      p({ aktueller_verbleib: null, aktuelle_uhs_id: 7 }),
      p({ aktueller_verbleib: null, aktuelle_uhs_id: 9 }),
      // Vermisst zählt nicht mit — auch nicht als „offen".
      p({ status: 'vermisst', aktueller_verbleib: null }),
    ];
    const namen: Record<number, string> = { 7: 'Weserstadion' };
    expect(verbleibZaehlung(alle, (id) => namen[id])).toEqual([
      { schluessel: 'transport', label: 'Transport', wert: 2, offen: false },
      { schluessel: 'uhs:7', label: 'Weserstadion', wert: 2, offen: false },
      { schluessel: 'vor_ort', label: 'vor Ort', wert: 1, offen: false },
      { schluessel: 'uhs:9', label: 'Unfallhilfsstelle', wert: 1, offen: false },
      { schluessel: 'offen', label: 'offen', wert: 0, offen: true },
    ]);
  });
});

describe('sichtungsbild', () => {
  it('zählt alle Personen je Sichtung, Ungesichtete unter „ohne"', () => {
    const bild = sichtungsbild([
      { aktuelle_sichtung: 'sk1' },
      { aktuelle_sichtung: 'sk3' },
      { aktuelle_sichtung: 'sk3' },
      { aktuelle_sichtung: 'tot' },
      { aktuelle_sichtung: 'unverletzt' },
      { aktuelle_sichtung: null },
      {},
    ]);
    expect(bild).toEqual({
      gesamt: 7,
      je: { sk1: 1, sk2: 0, sk3: 2, sk4: 0, tot: 1, unverletzt: 1, ohne: 2 },
    });
  });
});
