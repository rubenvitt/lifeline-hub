import { describe, expect, it } from 'vitest';
import { auswahlZeilen } from './druckAuswahl';

/**
 * Die gedruckte Auswahl in Worten (LFH-22, design.md D6). Der Fehlermodus der Zeitachse ist
 * eine STILLE Verschiebung um den Zonenversatz — deshalb beidseits beider
 * Sommerzeitgrenzen gegen feste UTC-Zeitpunkte, in einer AUSDRÜCKLICH gesetzten Zone (die
 * Zone der Testmaschine darf das Ergebnis nicht bestimmen).
 */

const BERLIN = { zeitzone: 'Europe/Berlin' };
const typWort = (t: string) => ({ meldung: 'Meldung', berichtigung: 'Berichtigung' })[t] ?? t;
const keineEinheit = () => undefined;

function zeilen(filter: Parameters<typeof auswahlZeilen>[0], zone = BERLIN) {
  return auswahlZeilen(filter, { konventionen: zone, typWort, einheitName: keineEinheit });
}

describe('auswahlZeilen', () => {
  it('nennt ohne Filter „vollständiges Tagebuch"', () => {
    expect(zeilen({})).toEqual(['vollständiges Tagebuch']);
  });

  it('nennt den Typ als Typwort', () => {
    expect(zeilen({ typ: 'meldung' })).toEqual(['Typ: Meldung']);
  });

  it('nennt den Suchbegriff wörtlich', () => {
    expect(zeilen({ q: 'Brücke & Damm' })).toEqual(['Suchbegriff: „Brücke & Damm“']);
  });

  it.each([
    // Sommerzeit (MESZ, UTC+2): 06:00Z → 08:00, 10:00Z → 12:00 (Szenario der Spec).
    [
      '2026-09-21 06:00:00',
      '2026-09-21 10:00:00',
      'Zeitraum: 21.09.2026 08:00 bis 21.09.2026 12:00',
    ],
    // Winterzeit (MEZ, UTC+1).
    [
      '2026-01-15 07:00:00',
      '2026-01-15 11:00:00',
      'Zeitraum: 15.01.2026 08:00 bis 15.01.2026 12:00',
    ],
    // Beginn der Sommerzeit am 29.03.2026: 00:30Z = 01:30 MEZ, 01:30Z = 03:30 MESZ.
    [
      '2026-03-29 00:30:00',
      '2026-03-29 01:30:00',
      'Zeitraum: 29.03.2026 01:30 bis 29.03.2026 03:30',
    ],
    // Ende der Sommerzeit am 25.10.2026: 00:30Z = 02:30 MESZ, 01:30Z = 02:30 MEZ.
    [
      '2026-10-25 00:30:00',
      '2026-10-25 01:30:00',
      'Zeitraum: 25.10.2026 02:30 bis 25.10.2026 02:30',
    ],
  ])('nennt den Zeitraum %s bis %s in der Org-Zone', (von, bis, erwartet) => {
    expect(zeilen({ von, bis })).toEqual([erwartet]);
  });

  it('rechnet in der gesetzten Zone, nicht in der der Maschine', () => {
    // New York im September: UTC−4. 12:00Z → 08:00.
    expect(zeilen({ von: '2026-09-21 12:00:00' }, { zeitzone: 'America/New_York' })).toEqual([
      'Zeitraum: ab 21.09.2026 08:00',
    ]);
  });

  it('nennt einen offenen Zeitraum mit „ab" bzw. „bis"', () => {
    expect(zeilen({ bis: '2026-09-21 10:00:00' })).toEqual(['Zeitraum: bis 21.09.2026 12:00']);
  });

  it('nennt eine Einheit mit Namen', () => {
    expect(
      auswahlZeilen(
        { einheit_id: 12 },
        { konventionen: BERLIN, typWort, einheitName: (id) => (id === 12 ? '1. Zug' : undefined) },
      ),
    ).toEqual(['betrifft 1. Zug']);
  });

  it('nennt eine Einheit ohne lesbaren Namen ohne Kennung', () => {
    const z = zeilen({ einheit_id: 12 });
    expect(z).toEqual(['betrifft eine Einheit (Name nicht verfügbar)']);
    expect(z.join(' ')).not.toMatch(/12/);
  });

  it('reiht mehrere Merkmale in fester Folge: Typ, Zeitraum, Suchbegriff, Einheit', () => {
    expect(
      zeilen({ q: 'Damm', typ: 'meldung', von: '2026-09-21 06:00:00', einheit_id: 3 }),
    ).toEqual([
      'Typ: Meldung',
      'Zeitraum: ab 21.09.2026 08:00',
      'Suchbegriff: „Damm“',
      'betrifft eine Einheit (Name nicht verfügbar)',
    ]);
  });
});
