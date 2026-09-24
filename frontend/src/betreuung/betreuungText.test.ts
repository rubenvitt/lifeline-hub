import { describe, expect, it } from 'vitest';
import {
  evakuiertText,
  freiePlaetze,
  kennzahlTeile,
  kennzahlText,
  mengeText,
  namentlichText,
  personenZahl,
} from './betreuungText';
import { evakuierungKennzahl } from './evakuierungKennzahl';

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

  it('Kennzahltext ohne Meldung: eine geschätzte Plangröße bleibt gekennzeichnet (≈ an M)', () => {
    // Spec „Kennzahl": ist eine beteiligte Plangröße geschätzt, MUST die Kennzahl als
    // geschätzt gekennzeichnet sein — auch solange noch kein Stand gemeldet ist.
    expect(
      kennzahlText({
        evakuiert: null,
        geplant: 1850,
        bezirke: 1,
        ohneMeldung: 1,
        geschaetzt: true,
      }),
    ).toBe(`keine Meldung · von ≈ 1${T}850 geplant · 1 ohne Meldung`);
  });

  it('Kennzahltext „nur Plan geschätzt": der Vorgabeweg des Anlegen-Dialogs, noch ohne Stand', () => {
    // Zusammengesetzt statt als Flag: nur so ist „nur die Plangröße ist geschätzt" überhaupt
    // ausdrückbar — genau der Fall aus dem Review (BezirkAnlegenDialog belegt `geschaetzt` vor).
    const k = evakuierungKennzahl([
      {
        raeumung: 'angeordnet',
        storniert_at: undefined,
        plan_personen: 1850,
        plan_erhebung: 'geschaetzt',
        stand: undefined,
      },
    ]);
    expect(kennzahlText(k)).toBe(`keine Meldung · von ≈ 1${T}850 geplant · 1 ohne Meldung`);
    // Gegenstück: gezählte Plangröße ohne Stand trägt kein ≈.
    const gezaehlt = evakuierungKennzahl([
      {
        raeumung: 'angeordnet',
        storniert_at: undefined,
        plan_personen: 1850,
        plan_erhebung: 'gezaehlt',
        stand: undefined,
      },
    ]);
    expect(kennzahlText(gezaehlt)).toBe(`keine Meldung · von 1${T}850 geplant · 1 ohne Meldung`);
  });

  // LFH-607: Dashboard-Zelle und Blockkopf lesen EINE Formatierung. Die Zelle zeigt N als Wert
  // und den Rest als Notiz; ohne Meldung ist N `null` (die Zelle setzt „—", nie 0).
  describe('kennzahlTeile (LFH-607)', () => {
    it('gezählt: N als Wert, „von M geplant" als Notiz', () => {
      expect(
        kennzahlTeile({
          evakuiert: 1320,
          geplant: 1850,
          bezirke: 2,
          ohneMeldung: 0,
          geschaetzt: false,
        }),
      ).toEqual({ evakuiert: `1${T}320`, notiz: `von 1${T}850 geplant` });
    });

    it('geschätzt mit N: ≈ an N, Bezirke ohne Meldung in der Notiz', () => {
      expect(
        kennzahlTeile({
          evakuiert: 600,
          geplant: 1850,
          bezirke: 2,
          ohneMeldung: 1,
          geschaetzt: true,
        }),
      ).toEqual({ evakuiert: '≈ 600', notiz: `von 1${T}850 geplant · 1 ohne Meldung` });
    });

    it('ohne jede Meldung: N ist null, nie 0; ≈ wandert an M', () => {
      expect(
        kennzahlTeile({
          evakuiert: null,
          geplant: 640,
          bezirke: 1,
          ohneMeldung: 1,
          geschaetzt: true,
        }),
      ).toEqual({ evakuiert: null, notiz: 'von ≈ 640 geplant · 1 ohne Meldung' });
      expect(
        kennzahlTeile({
          evakuiert: null,
          geplant: 640,
          bezirke: 1,
          ohneMeldung: 1,
          geschaetzt: false,
        }),
      ).toEqual({ evakuiert: null, notiz: 'von 640 geplant · 1 ohne Meldung' });
    });

    it('Evakuierte über Plan werden nicht gedeckelt', () => {
      expect(
        kennzahlTeile({
          evakuiert: 700,
          geplant: 640,
          bezirke: 1,
          ohneMeldung: 0,
          geschaetzt: false,
        }).evakuiert,
      ).toBe('700');
    });
  });
});

describe('namentlichText (LFH-674, design.md D7)', () => {
  it('„davon namentlich n" neben einer gemeldeten Belegung', () => {
    expect(namentlichText(2, true)).toBe('davon namentlich 2');
  });

  it('ohne Belegungsmeldung entfällt „davon" — es gibt keine Menge, von der es ein Teil wäre', () => {
    expect(namentlichText(2, false)).toBe('namentlich 2');
  });

  it('bei 0 oder ohne Auskunft steht nichts', () => {
    expect(namentlichText(0, true)).toBeNull();
    expect(namentlichText(undefined, true)).toBeNull();
  });

  it('große Zahlen tragen den Tausendertrenner wie jede Personenzahl', () => {
    expect(namentlichText(1320, true)).toBe(`davon namentlich ${personenZahl(1320)}`);
  });
});
