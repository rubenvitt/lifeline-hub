import { describe, expect, it } from 'vitest';
import { mitProzessZone } from '../test/prozessZone';
import { formatKalenderdatum, parseKalenderdatum } from './kalenderdatum';

/**
 * Kalenderdatum ohne Uhrzeit und Zone (LLH-1103, Spec `zeiteingabe`, „Kalenderdatum ohne Uhrzeit
 * und Zone“; Change `f8218h1i-personendaten-feldweise`, design.md D6).
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 * - Jahrhundertregel `> heuteJahr` → `>= heuteJahr`: „19.10.26“ wird 1926, rot in „zweistelliges
 *   Jahr im laufenden Jahr“.
 * - Schaltjahrregel ohne die 400er-Ausnahme: „29.02.2000“ abgelehnt, rot in „29.02.“.
 * - Zukunftsvergleich `>` → `>=`: heute selbst abgelehnt, rot in „heute ist erlaubt“.
 * - `formatKalenderdatum` ohne Kalenderprüfung: „2026-02-30“ würde „30.02.2026“, rot in
 *   „Rohanzeige“.
 */
const HEUTE = '2026-10-19';

function datum(text: string, heute = HEUTE) {
  const r = parseKalenderdatum(text, heute);
  return r.ok ? r.datum : `FEHLER: ${r.grund}`;
}

describe('parseKalenderdatum · Schreibweisen', () => {
  it('TT.MM.JJJJ', () => {
    expect(datum('14.07.1980')).toBe('1980-07-14');
  });

  it('T.M.JJJJ', () => {
    expect(datum('4.7.1980')).toBe('1980-07-04');
  });

  it('TT.MM.JJ', () => {
    expect(datum('01.02.80')).toBe('1980-02-01');
  });

  it('YYYY-MM-DD', () => {
    expect(datum('1980-07-14')).toBe('1980-07-14');
  });

  it('Leerraum außen zählt nicht', () => {
    expect(datum('  14.07.1980 ')).toBe('1980-07-14');
  });

  it('leer ist kein Fehler, sondern „ohne Angabe“', () => {
    expect(parseKalenderdatum('', HEUTE)).toEqual({ ok: true, datum: null });
    expect(parseKalenderdatum('   ', HEUTE)).toEqual({ ok: true, datum: null });
  });
});

describe('parseKalenderdatum · zweistelliges Jahr', () => {
  it('Spec-Szenario: im Jahr 2026 wird „01.02.80“ zu 1980', () => {
    expect(datum('01.02.80')).toBe('1980-02-01');
  });

  it('das jüngste Jahr, das nicht in der Zukunft liegt: „26“ ist 2026, „27“ ist 1927', () => {
    expect(datum('01.01.26')).toBe('2026-01-01');
    expect(datum('01.01.27')).toBe('1927-01-01');
    expect(datum('01.01.00')).toBe('2000-01-01');
    expect(datum('01.01.99')).toBe('1999-01-01');
  });

  it('zweistelliges Jahr im laufenden Jahr: heute gilt, ein späterer Tag ist Zukunft', () => {
    expect(datum('19.10.26')).toBe('2026-10-19');
    // Das Jahr 2026 liegt nicht in der Zukunft; der Tag schon. Nicht still um 100 Jahre zurück.
    expect(datum('20.10.26')).toBe('FEHLER: liegt in der Zukunft');
  });

  it('an der Jahrhundertgrenze: im Jahr 2000 ist „00“ 2000 und „01“ 1901', () => {
    expect(datum('01.01.00', '2000-06-01')).toBe('2000-01-01');
    expect(datum('01.01.01', '2000-06-01')).toBe('1901-01-01');
    expect(datum('31.12.99', '2000-06-01')).toBe('1999-12-31');
  });
});

describe('parseKalenderdatum · Kalender', () => {
  it('29.02. nur im Schaltjahr', () => {
    expect(datum('29.02.2024')).toBe('2024-02-29');
    expect(datum('29.02.2000')).toBe('2000-02-29');
    expect(datum('29.02.2023')).toBe('FEHLER: Tag gibt es nicht');
    expect(datum('29.02.1900')).toBe('FEHLER: Tag gibt es nicht');
    expect(datum('1900-02-29')).toBe('FEHLER: Tag gibt es nicht');
  });

  it('Tag und Monat außerhalb des Kalenders', () => {
    expect(datum('31.04.1980')).toBe('FEHLER: Tag gibt es nicht');
    expect(datum('00.04.1980')).toBe('FEHLER: Tag gibt es nicht');
    expect(datum('32.01.1980')).toBe('FEHLER: Tag gibt es nicht');
    expect(datum('14.13.1980')).toBe('FEHLER: Monat gibt es nicht');
    expect(datum('14.00.1980')).toBe('FEHLER: Monat gibt es nicht');
    expect(datum('1980-13-01')).toBe('FEHLER: Monat gibt es nicht');
  });
});

describe('parseKalenderdatum · Zukunft', () => {
  it('heute ist erlaubt, morgen nicht', () => {
    expect(datum('19.10.2026')).toBe('2026-10-19');
    expect(datum('20.10.2026')).toBe('FEHLER: liegt in der Zukunft');
    expect(datum('2027-01-01')).toBe('FEHLER: liegt in der Zukunft');
  });

  it('„heute“ ist der Tag, den der Aufrufer übergibt (Anzeigezone), nicht die Uhr', () => {
    expect(datum('20.10.2026', '2026-10-20')).toBe('2026-10-20');
  });
});

describe('parseKalenderdatum · Unsinn wird nie erraten', () => {
  it.each([
    'gestern',
    'ca. 1980',
    '14.07',
    '14.07.',
    '14.07.198',
    '14/07/1980',
    '14-07-1980',
    '1980-7-14',
    '14.07.1980 10:00',
    '1980-07-14T00:00',
    '140780',
    '١٤.٠٧.١٩٨٠',
  ])('„%s“ ist nicht lesbar', (text) => {
    expect(datum(text)).toBe('FEHLER: nicht lesbar');
  });
});

describe('parseKalenderdatum · Zone ohne Einfluss', () => {
  mitProzessZone('Pacific/Auckland');

  it('Spec-Szenario: in Auckland bleibt „14.07.1980“ der 14.07.1980', () => {
    expect(datum('14.07.1980')).toBe('1980-07-14');
    expect(formatKalenderdatum('1980-07-14')).toBe('14.07.1980');
  });

  it('die Zukunftsgrenze folgt nur dem übergebenen Tag', () => {
    expect(datum('19.10.2026')).toBe('2026-10-19');
    expect(datum('20.10.2026')).toBe('FEHLER: liegt in der Zukunft');
  });
});

describe('formatKalenderdatum', () => {
  it('YYYY-MM-DD als TT.MM.JJJJ', () => {
    expect(formatKalenderdatum('1980-02-01')).toBe('01.02.1980');
    expect(formatKalenderdatum('2024-02-29')).toBe('29.02.2024');
  });

  it('Rohanzeige: ein alter Freitextwert erscheint unverändert', () => {
    expect(formatKalenderdatum('ca. 1980')).toBe('ca. 1980');
    expect(formatKalenderdatum('14.7.80')).toBe('14.7.80');
    expect(formatKalenderdatum('2026-02-30')).toBe('2026-02-30');
    expect(formatKalenderdatum('1980-07-14 00:00:00')).toBe('1980-07-14 00:00:00');
  });

  it('leer bleibt leer', () => {
    expect(formatKalenderdatum(null)).toBe('');
    expect(formatKalenderdatum(undefined)).toBe('');
    expect(formatKalenderdatum('')).toBe('');
  });

  it('Rundweg: was formatiert wurde, liest der Parser zurück', () => {
    for (const iso of ['1980-07-14', '2000-02-29', '1926-12-31']) {
      expect(datum(formatKalenderdatum(iso))).toBe(iso);
    }
  });
});
