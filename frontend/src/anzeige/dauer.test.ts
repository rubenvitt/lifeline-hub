import { describe, expect, it } from 'vitest';
import faelle from './dauer.faelle.json';
import { dauer, dauerAusgeschrieben, dauerZwischen, relativ, vorText } from './dauer';

const MIN = 60_000;

describe('Eine Form für Dauern (LLH-1750, Spec zeitdarstellung)', () => {
  it.each(faelle.faelle)('$minuten min, Tage $tage → „$text“', ({ minuten, tage, text }) => {
    expect(dauer(minuten, { tage: tage === true })).toBe(text);
  });

  it('rundet angebrochene Minuten ab und kennt keine negative Dauer', () => {
    expect(dauer(45.9)).toBe('45 min');
    expect(dauer(-3)).toBe('0 min');
  });

  it('trägt nie einen Doppelpunkt', () => {
    for (const f of faelle.faelle) expect(f.text).not.toContain(':');
  });
});

describe('Relative Angaben in der Form der Dauer', () => {
  it('setzt das Vorwort vor die Dauer, mit Tagen ab 24 h', () => {
    expect(relativ(301, 'seit')).toBe('seit 5 h 01 min');
    expect(relativ(25, 'in')).toBe('in 25 min');
    expect(relativ(40, 'noch')).toBe('noch 40 min');
    expect(relativ(3740, 'vor')).toBe('vor 2 d 14 h');
  });

  it('nennt unter einer Minute „gerade eben“ bzw. „< 1 min“', () => {
    expect(relativ(0, 'vor')).toBe('gerade eben');
    expect(relativ(0, 'in')).toBe('in < 1 min');
    expect(relativ(0, 'seit')).toBe('seit < 1 min');
    expect(relativ(0, 'noch')).toBe('noch < 1 min');
  });

  it('vorText liest Wire-Strings als UTC und Epochen', () => {
    const jetzt = Date.UTC(2026, 10, 17, 17, 33);
    expect(vorText('2026-11-17T17:31:00', jetzt)).toBe('vor 2 min');
    expect(vorText(jetzt - 185 * MIN, jetzt)).toBe('vor 3 h 05 min');
    expect(vorText(jetzt - 184 * MIN, jetzt)).toBe('vor 3 h 04 min');
    expect(vorText(jetzt - 180 * MIN, jetzt)).toBe('vor 3 h');
    expect(vorText('2026-11-17 16:51:00', jetzt)).toBe('vor 42 min');
    expect(vorText(jetzt - 20_000, jetzt)).toBe('gerade eben');
  });

  it('vorText nennt eine Zeit in der Zukunft (Uhrversatz) „gerade eben“ und Leeres leer', () => {
    const jetzt = Date.UTC(2026, 10, 17, 17, 33);
    expect(vorText(jetzt + 2 * MIN, jetzt)).toBe('gerade eben');
    expect(vorText(null, jetzt)).toBe('');
    expect(vorText('', jetzt)).toBe('');
  });
});

describe('Dauer zwischen zwei Wire-Zeitpunkten (Einsatzdauer)', () => {
  const jetzt = Date.UTC(2026, 10, 17, 17, 33);

  it('liest den Wire-String als UTC und zeigt Tage', () => {
    expect(dauerZwischen('2026-11-17T12:32:00', null, jetzt)).toBe('5 h 01 min');
    expect(dauerZwischen('2026-11-15T03:13:00', null, jetzt)).toBe('2 d 14 h');
    expect(dauerZwischen('2026-11-17 12:32:00', null, jetzt)).toBe('5 h 01 min');
    expect(dauerZwischen('2026-11-16 17:33:00', null, jetzt)).toBe('1 d');
    expect(dauerZwischen('2026-11-16 17:34:00', null, jetzt)).toBe('23 h 59 min');
  });

  it('zählt bis zum Ende, einen Beginn in der Zukunft als 0 und Unlesbares als null', () => {
    expect(dauerZwischen('2026-11-17T08:00:00', '2026-11-17T12:00:00', jetzt)).toBe('4 h');
    expect(dauerZwischen('2026-11-17T18:00:00', null, jetzt)).toBe('0 min');
    expect(dauerZwischen('kein Datum', null, jetzt)).toBeNull();
    expect(dauerZwischen(null, null, jetzt)).toBeNull();
  });
});

describe('Ausgeschriebene Dauer für Vorlesehilfen', () => {
  it('nennt Stunden und Minuten als Wörter', () => {
    expect(dauerAusgeschrieben(1)).toBe('1 Minute');
    expect(dauerAusgeschrieben(40)).toBe('40 Minuten');
    expect(dauerAusgeschrieben(60)).toBe('1 Stunde');
    expect(dauerAusgeschrieben(312)).toBe('5 Stunden 12 Minuten');
  });
});
