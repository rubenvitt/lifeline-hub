import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import {
  hatLuecke,
  istAngetroffen,
  lueckenText,
  lueckenVon,
  offeneFelder,
  sichtungsbild,
  transportBilanz,
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
  aktuelle_verbleib_art: 'transport',
  aktuelles_verbleib_ziel: 'KH Mitte',
  aktueller_verbleib_status: 'abtransportiert',
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
    expect(lueckenVon(p({ aktuelle_verbleib_art: undefined }))).toEqual({
      verbleib: true,
      fundort: false,
    });
    expect(lueckenVon(p({ antreff_ort: '  ' }))).toEqual({ verbleib: false, fundort: true });
  });

  it('liest den Verbleib aus der Art, nicht aus der Kurzform (LFH-613)', () => {
    // Eine Kurzform ohne Art schließt die Lücke NICHT mehr — sie wird nicht zurückgeparst.
    expect(
      lueckenVon(p({ aktuelle_verbleib_art: undefined, aktueller_verbleib: 'Transport' })).verbleib,
    ).toBe(true);
    expect(
      lueckenVon(p({ aktuelle_verbleib_art: 'notunterkunft', aktueller_verbleib: null })).verbleib,
    ).toBe(false);
  });

  it('schließt die Fundort-Lücke mit Freitext ODER Koordinate (LFH-613)', () => {
    const ohne = { antreff_ort: null, antreff_lat: undefined, antreff_lon: undefined };
    expect(lueckenVon(p(ohne)).fundort).toBe(true);
    expect(lueckenVon(p({ ...ohne, antreff_lat: 52.2691, antreff_lon: 9.1342 })).fundort).toBe(
      false,
    );
    expect(lueckenVon(p({ ...ohne, antreff_ort: 'Brücke' })).fundort).toBe(false);
    // Ein halbes Paar ist kein Fundort (dieselbe Regel wie Anzeige und Bearbeiten).
    expect(lueckenVon(p({ ...ohne, antreff_lat: 52.2691 })).fundort).toBe(true);
  });

  it('zählt eine Person in einer UHS nicht als „Verbleib offen"', () => {
    expect(lueckenVon(p({ aktuelle_verbleib_art: undefined, aktuelle_uhs_id: 7 })).verbleib).toBe(
      false,
    );
  });

  it('führt eine vermisste Person ohne Fundort und Verbleib NICHT als Lücke', () => {
    const vermisst = p({ status: 'vermisst', antreff_ort: null, aktuelle_verbleib_art: undefined });
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
      p({ aktuelle_verbleib_art: undefined }),
      p({ aktuelle_verbleib_art: undefined, antreff_ort: null }),
      p({ antreff_ort: null }),
      p({ status: 'vermisst', aktuelle_verbleib_art: undefined, antreff_ort: null }),
    ];
    expect(offeneFelder(alle)).toEqual({ ohneVerbleib: 2, ohneFundort: 2, datensaetze: 3 });
  });
});

describe('verbleibKlasse / verbleibZaehlung', () => {
  it('leitet die Klasse aus der Art, dann UHS, sonst offen ab', () => {
    expect(verbleibKlasse({ aktuelle_verbleib_art: 'entlassung', aktuelle_uhs_id: 7 })).toBe(
      'entlassung',
    );
    expect(verbleibKlasse({ aktuelle_verbleib_art: null, aktuelle_uhs_id: 7 })).toBe('uhs');
    expect(verbleibKlasse({ aktuelle_uhs_id: null })).toBe('offen');
  });

  it('zählt nach Art — das Spec-Szenario „Zählung nach Art" (LFH-613)', () => {
    const ohneVerbleib = { aktuelle_verbleib_art: undefined, aktueller_verbleib: null };
    const alle = [
      p({ aktuelle_verbleib_art: 'transport' }),
      p({ aktuelle_verbleib_art: 'transport', aktueller_verbleib_status: 'angemeldet' }),
      p({ aktuelle_verbleib_art: 'notunterkunft', aktuelles_verbleib_ziel: 'Turnhalle Ost' }),
      p({ ...ohneVerbleib, aktuelle_uhs_id: 7 }),
      p(ohneVerbleib),
    ];
    const namen: Record<number, string> = { 7: 'Weserstadion' };
    expect(verbleibZaehlung(alle, (id) => namen[id])).toEqual([
      { schluessel: 'transport', label: 'Transport', wert: 2, offen: false },
      { schluessel: 'notunterkunft', label: 'Notunterkunft', wert: 1, offen: false },
      { schluessel: 'uhs:7', label: 'Weserstadion', wert: 1, offen: false },
      { schluessel: 'offen', label: 'offen', wert: 1, offen: true },
    ]);
  });

  it('zählt je Art und je UHS, „offen" zuletzt und immer', () => {
    const ohneVerbleib = { aktuelle_verbleib_art: undefined, aktueller_verbleib: null };
    const alle = [
      p({}),
      p({ aktuelle_verbleib_art: 'transport', aktueller_verbleib: 'Transport' }),
      p({ aktuelle_verbleib_art: 'vor_ort', aktueller_verbleib: 'vor Ort' }),
      p({ ...ohneVerbleib, aktuelle_uhs_id: 7 }),
      p({ ...ohneVerbleib, aktuelle_uhs_id: 7 }),
      p({ ...ohneVerbleib, aktuelle_uhs_id: 9 }),
      // Vermisst zählt nicht mit — auch nicht als „offen".
      p({ status: 'vermisst', ...ohneVerbleib }),
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

  it('zählt eine Kurzform ohne Art NICHT still als Art', () => {
    const alle = [p({ aktuelle_verbleib_art: undefined, aktueller_verbleib: 'Transport' })];
    expect(verbleibZaehlung(alle, () => undefined)).toEqual([
      { schluessel: 'offen', label: 'offen', wert: 1, offen: true },
    ]);
  });
});

describe('transportBilanz', () => {
  it('zählt das Spec-Szenario „Transportiert / offen" als 2 / 2', () => {
    const ohneVerbleib = { aktuelle_verbleib_art: undefined, aktueller_verbleib: null };
    const alle = [
      p({ aktuelle_verbleib_art: 'transport', aktueller_verbleib_status: 'abtransportiert' }),
      p({ aktuelle_verbleib_art: 'transport', aktueller_verbleib_status: undefined }),
      p({ aktuelle_verbleib_art: 'transport', aktueller_verbleib_status: 'angemeldet' }),
      p(ohneVerbleib),
      p(ohneVerbleib),
    ];
    expect(transportBilanz(alle)).toEqual({ transportiert: 2, offen: 2 });
  });

  it('zählt nur angetroffene Personen; UHS und andere Arten sind weder noch', () => {
    const ohneVerbleib = { aktuelle_verbleib_art: undefined, aktueller_verbleib: null };
    const alle = [
      p({ status: 'vermisst', ...ohneVerbleib }),
      p({ status: 'abgemeldet', aktuelle_verbleib_art: 'transport' }),
      p({ ...ohneVerbleib, aktuelle_uhs_id: 7 }),
      p({ aktuelle_verbleib_art: 'notunterkunft' }),
    ];
    expect(transportBilanz(alle)).toEqual({ transportiert: 0, offen: 0 });
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
