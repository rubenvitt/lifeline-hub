import { describe, expect, it } from 'vitest';
import {
  evakuiertText,
  freiePlaetze,
  kennzahlText,
  mengeText,
  personenZahl,
} from './betreuungText';

/** Schmales geschütztes Leerzeichen — als Literal, nicht aus der Datei zurückgelesen. */
const T = ' ';

describe('betreuungText (LFH-639)', () => {
  it('trennt Tausender mit schmalem geschütztem Leerzeichen', () => {
    expect(personenZahl(0)).toBe('0');
    expect(personenZahl(640)).toBe('640');
    expect(personenZahl(1320)).toBe(`1${T}320`);
    expect(personenZahl(1234567)).toBe(`1${T}234${T}567`);
  });

  it('kennzeichnet geschätzte Mengen mit ≈, gezählte nicht', () => {
    expect(mengeText(640, 'geschaetzt')).toBe('≈ 640');
    expect(mengeText(640, 'gezaehlt')).toBe('640');
  });

  it('„N · von M geplant", ohne Meldung „keine Meldung" statt 0', () => {
    expect(
      evakuiertText({
        plan_personen: 1850,
        plan_erhebung: 'gezaehlt',
        stand: { id: 1, evakuiert: 1320, erhebung: 'gezaehlt', zeitpunkt_at: 'x' },
      }),
    ).toBe(`1${T}320 · von 1${T}850 geplant`);
    expect(
      evakuiertText({ plan_personen: 640, plan_erhebung: 'geschaetzt', stand: undefined }),
    ).toBe('keine Meldung · von ≈ 640 geplant');
    // Eine gemeldete 0 ist eine Zahl, keine fehlende Meldung.
    expect(
      evakuiertText({
        plan_personen: 640,
        plan_erhebung: 'gezaehlt',
        stand: { id: 1, evakuiert: 0, erhebung: 'geschaetzt', zeitpunkt_at: 'x' },
      }),
    ).toBe('≈ 0 · von 640 geplant');
    // Nicht gedeckelt.
    expect(
      evakuiertText({
        plan_personen: 640,
        plan_erhebung: 'gezaehlt',
        stand: { id: 1, evakuiert: 700, erhebung: 'gezaehlt', zeitpunkt_at: 'x' },
      }),
    ).toBe('700 · von 640 geplant');
  });

  it('freie Plätze nur mit Kapazität und Meldung; Überbelegung wird negativ', () => {
    expect(freiePlaetze({ kapazitaet_personen: undefined, belegung: undefined })).toBeNull();
    expect(
      freiePlaetze({
        kapazitaet_personen: undefined,
        belegung: { id: 1, belegt: 40, zeitpunkt_at: 'x' },
      }),
    ).toBeNull();
    expect(freiePlaetze({ kapazitaet_personen: 150, belegung: undefined })).toBeNull();
    expect(
      freiePlaetze({
        kapazitaet_personen: 150,
        belegung: { id: 1, belegt: 89, zeitpunkt_at: 'x' },
      }),
    ).toBe(61);
    expect(
      freiePlaetze({
        kapazitaet_personen: 150,
        belegung: { id: 1, belegt: 170, zeitpunkt_at: 'x' },
      }),
    ).toBe(-20);
  });

  it('Kennzahltext: ≈ bei geschätztem Anteil, Bezirke ohne Meldung ausgewiesen, keine Kennzahl benannt', () => {
    expect(
      kennzahlText({
        evakuiert: 1320,
        geplant: 1850,
        bezirke: 2,
        ohneMeldung: 0,
        geschaetzt: false,
      }),
    ).toBe(`1${T}320 · von 1${T}850 geplant`);
    expect(
      kennzahlText({ evakuiert: 600, geplant: 1850, bezirke: 2, ohneMeldung: 1, geschaetzt: true }),
    ).toBe(`≈ 600 · von 1${T}850 geplant · 1 ohne Meldung`);
    expect(
      kennzahlText({
        evakuiert: null,
        geplant: 640,
        bezirke: 1,
        ohneMeldung: 1,
        geschaetzt: false,
      }),
    ).toBe('keine Meldung · von 640 geplant · 1 ohne Meldung');
    expect(kennzahlText(null)).toBe('keine geplante Evakuierung');
  });
});
