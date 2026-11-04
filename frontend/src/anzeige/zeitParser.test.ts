import { describe, expect, it } from 'vitest';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { deuteZeit, type Deutung, type DeutungsOptionen } from './zeitParser';
import { mitProzessZone } from '../test/prozessZone';

dayjs.extend(utc);

const BERLIN = 'Europe/Berlin';
/** 2026-10-17 15:00 Berliner Zeit (Sommerzeit, UTC+2). */
const JETZT = dayjs.utc('2026-10-17 13:00:00');

function deute(text: string, optionen: Partial<DeutungsOptionen> = {}): Deutung {
  return deuteZeit(text, { zone: BERLIN, jetzt: JETZT, ...optionen });
}

/** Der gedeutete Zeitpunkt als Wire-Wert (UTC), sonst der Grund. */
function utcVon(text: string, optionen: Partial<DeutungsOptionen> = {}): string {
  const d = deute(text, optionen);
  if (!d.ok) return `✗ ${d.grund}`;
  return d.zeitpunkt ? d.zeitpunkt.utc().format('YYYY-MM-DD HH:mm:ss') : '∅';
}

function hinweis(text: string, optionen: Partial<DeutungsOptionen> = {}) {
  const d = deute(text, optionen);
  return d.ok ? d.hinweis : undefined;
}

describe('deuteZeit (Spec zeiteingabe, Eingabe als Text)', () => {
  // Browser auf UTC, Anzeigezone Berlin: sonst fiele eine Verwechslung der Zonen nicht auf.
  mitProzessZone('UTC');

  describe('Uhrzeit allein', () => {
    it.each(['1430', '14:30', '14.30', ' 1430 '])(
      '„%s“ gilt heute 14:30 in der Anzeigezone',
      (t) => {
        expect(utcVon(t)).toBe('2026-10-17 12:30:00');
      },
    );

    it('liest drei Ziffern als HMM', () => {
      expect(utcVon('630')).toBe('2026-10-17 04:30:00');
      expect(utcVon('6:30')).toBe('2026-10-17 04:30:00');
    });

    it('lehnt zwei und fünf Ziffern ab, statt zu raten', () => {
      expect(utcVon('14')).toBe('✗ nicht lesbar');
      expect(utcVon('14305')).toBe('✗ nicht lesbar');
    });

    it('nennt eine Uhrzeit, die es nicht gibt', () => {
      expect(utcVon('2460')).toBe('✗ Uhrzeit gibt es nicht');
      expect(utcVon('1260')).toBe('✗ Uhrzeit gibt es nicht');
      expect(utcVon('2400')).toBe('✗ Uhrzeit gibt es nicht');
    });
  });

  describe('Tag und Uhrzeit (TTHHMM)', () => {
    it('liegt ohne Feldart im laufenden Monat', () => {
      expect(utcVon('101430')).toBe('2026-10-10 12:30:00');
    });

    it('nennt einen Tag, den es im Monat nicht gibt', () => {
      const november = dayjs.utc('2026-11-15 10:00:00');
      expect(utcVon('311430', { jetzt: november })).toBe('✗ Tag gibt es nicht');
      expect(utcVon('001430')).toBe('✗ Tag gibt es nicht');
    });
  });

  describe('volle Datum-Zeit-Gruppe', () => {
    it.each(['101430okt26', '101430okt26', '101430Okt26', '101430 okt 26', '101430okt'])(
      '„%s“ gilt 10.10.2026 14:30',
      (t) => {
        expect(utcVon(t)).toBe('2026-10-10 12:30:00');
      },
    );

    it.each(['mrz', 'mär', 'maer', 'mar'])('kennt „%s“ für März', (m) => {
      // 16.03.2026 ist Winterzeit (UTC+1).
      expect(utcVon(`161430${m}26`)).toBe('2026-03-16 13:30:00');
    });

    it.each([
      ['jan', '01'],
      ['feb', '02'],
      ['apr', '04'],
      ['mai', '05'],
      ['jun', '06'],
      ['jul', '07'],
      ['aug', '08'],
      ['sep', '09'],
      ['nov', '11'],
      ['dez', '12'],
    ])('kennt „%s“', (m, nummer) => {
      expect(utcVon(`051200${m}26`).slice(0, 10)).toBe(`2026-${nummer}-05`);
    });

    it('nennt ein unbekanntes Monatskürzel', () => {
      expect(utcVon('101430xyz26')).toBe('✗ Monat unbekannt');
    });

    it('nennt den 31. November', () => {
      expect(utcVon('311430nov26')).toBe('✗ Tag gibt es nicht');
    });
  });

  describe('deutsche und ISO-Schreibweise', () => {
    it.each(['10.10.26 1430', '10.10.2026 14:30', '10.10.2026, 14.30', '10.10. 1430'])(
      '„%s“ gilt 10.10.2026 14:30',
      (t) => {
        expect(utcVon(t)).toBe('2026-10-10 12:30:00');
      },
    );

    it('liest ISO mit und ohne Sekunden', () => {
      expect(utcVon('2026-10-10 14:30')).toBe('2026-10-10 12:30:00');
      expect(utcVon('2026-10-10 14:30:15')).toBe('2026-10-10 12:30:15');
      expect(utcVon('2026-10-10T14:30')).toBe('2026-10-10 12:30:00');
    });

    it('nennt einen Monat, den es nicht gibt', () => {
      expect(utcVon('10.13.2026 14:30')).toBe('✗ Monat gibt es nicht');
    });
  });

  describe('relativ und jetzt (nach der hineingereichten Uhr)', () => {
    it.each(['j', 'J', 'jetzt', 'Jetzt'])('„%s“ ist jetzt', (t) => {
      expect(utcVon(t)).toBe('2026-10-17 13:00:00');
    });

    it.each([
      ['-5', '2026-10-17 12:55:00'],
      ['−5', '2026-10-17 12:55:00'],
      ['-5m', '2026-10-17 12:55:00'],
      ['-5 min', '2026-10-17 12:55:00'],
      ['-1h', '2026-10-17 12:00:00'],
      ['+90', '2026-10-17 14:30:00'],
      ['+2h', '2026-10-17 15:00:00'],
      ['+2 std', '2026-10-17 15:00:00'],
    ])('„%s“', (t, erwartet) => {
      expect(utcVon(t)).toBe(erwartet);
    });
  });

  describe('Richtung nach Feldart (Spec „Richtung nach Feldart“)', () => {
    /** 2026-10-17 00:20 Berliner Zeit. */
    const nachMitternacht = dayjs.utc('2026-10-16 22:20:00');
    /** 2026-10-17 22:00 Berliner Zeit. */
    const abends = dayjs.utc('2026-10-17 20:00:00');

    it('Ereignis kurz nach Mitternacht fällt auf gestern', () => {
      const o = { jetzt: nachMitternacht, art: 'ereignis' as const };
      expect(utcVon('2350', o)).toBe('2026-10-16 21:50:00');
      expect(hinweis('2350', o)).toBe('gestern');
    });

    it('Ereignis wenige Minuten voraus bleibt heute (Uhren gehen nie gleich)', () => {
      const o = { art: 'ereignis' as const };
      expect(utcVon('1504', o)).toBe('2026-10-17 13:04:00');
      expect(utcVon('1506', o)).toBe('2026-10-16 13:06:00');
    });

    it('Frist am Abend fällt auf morgen', () => {
      const o = { jetzt: abends, art: 'frist' as const };
      expect(utcVon('0800', o)).toBe('2026-10-18 06:00:00');
      expect(hinweis('0800', o)).toBe('morgen');
    });

    it('ohne Feldart gilt heute, auch wenn die Uhrzeit vorbei ist', () => {
      expect(utcVon('0800', { jetzt: abends })).toBe('2026-10-17 06:00:00');
      expect(hinweis('0800', { jetzt: abends })).toBeUndefined();
    });

    it('Monatswechsel: am 1.11. ist „311430“ im Ereignisfeld der 31.10.', () => {
      const o = { jetzt: dayjs.utc('2026-11-01 08:00:00'), art: 'ereignis' as const };
      expect(utcVon('311430', o)).toBe('2026-10-31 13:30:00');
      expect(hinweis('311430', o)).toBe('gestern');
    });

    it('Frist: ein vergangener Tag im Monat fällt in den Folgemonat', () => {
      expect(utcVon('101430', { art: 'frist' })).toBe('2026-11-10 13:30:00');
    });

    it('DTG ohne Jahr im Ereignisfeld fällt ins Vorjahr, wenn sie sonst in der Zukunft läge', () => {
      expect(utcVon('101430dez', { art: 'ereignis' })).toBe('2025-12-10 13:30:00');
    });

    it('keine Zukunftstage ohne Feldart gilt als Ereignisfeld', () => {
      const o = { jetzt: nachMitternacht, keineZukunftstage: true };
      expect(utcVon('2350', o)).toBe('2026-10-16 21:50:00');
    });

    it('keine Zukunftstage lehnt einen ausdrücklichen Tag nach heute ab', () => {
      expect(utcVon('181430okt26', { keineZukunftstage: true })).toBe('✗ liegt in der Zukunft');
      expect(utcVon('+2h', { keineZukunftstage: true })).toBe('2026-10-17 15:00:00');
    });
  });

  describe('Bezug (Ende eines Zeitraums)', () => {
    const beginn = dayjs.utc('2026-10-24 10:00:00'); // 24.10. 12:00 Berlin

    it('eine Uhrzeit liegt am Tag des Bezugs', () => {
      expect(utcVon('1330', { bezug: beginn })).toBe('2026-10-24 11:30:00');
    });

    it('liegt sie dort nicht nach dem Bezug, am Folgetag', () => {
      const spaet = dayjs.utc('2026-10-17 20:00:00'); // 22:00 Berlin
      expect(utcVon('0600', { bezug: spaet })).toBe('2026-10-18 04:00:00');
      expect(utcVon('2200', { bezug: spaet })).toBe('2026-10-18 20:00:00');
    });

    it('ein ausdrücklicher Tag bleibt, wie er ist', () => {
      expect(utcVon('231330okt26', { bezug: beginn })).toBe('2026-10-23 11:30:00');
    });
  });

  describe('Sommerzeitgrenzen der Anzeigezone', () => {
    it('25.10.2026 02:30 ist die erste 02:30', () => {
      expect(utcVon('250230okt26')).toBe('2026-10-25 00:30:00');
    });

    it('25.10.2026 01:30 liegt vor der Umstellung', () => {
      expect(utcVon('25.10.2026 01:30')).toBe('2026-10-24 23:30:00');
    });

    it('29.03.2026 02:30 gibt es nicht und rückt um die Lücke nach vorn', () => {
      expect(utcVon('290230mrz26')).toBe('2026-03-29 01:30:00');
    });
  });

  describe('Umstellungsnächte nach Feldart (LLH-1472)', () => {
    // 25.10.2026: um 01:00 UTC springt die Uhr von 03:00 Sommerzeit auf 02:00 Winterzeit zurück.
    /** 02:20 Sommerzeit, das erste Mal. */
    const herbstErstes = dayjs.utc('2026-10-25 00:20:00');
    /** 02:20 Winterzeit, das zweite Mal. */
    const herbstZweites = dayjs.utc('2026-10-25 01:20:00');
    /** 03:20 Winterzeit. */
    const herbstDanach = dayjs.utc('2026-10-25 02:20:00');
    const ereignis = 'ereignis' as const;
    const frist = 'frist' as const;

    it('Ereignis: um 03:20 ist „0250“ die zweite 02:50, vor 30 Minuten', () => {
      expect(utcVon('0250', { jetzt: herbstDanach, art: ereignis })).toBe('2026-10-25 01:50:00');
      expect(hinweis('0250', { jetzt: herbstDanach, art: ereignis })).toBeUndefined();
    });

    it('Ereignis: um die zweite 02:20 ist „0250“ die erste, die zweite stünde noch bevor', () => {
      expect(utcVon('0250', { jetzt: herbstZweites, art: ereignis })).toBe('2026-10-25 00:50:00');
    });

    it('Ereignis: wenige Minuten vor der zweiten 02:50 gilt sie schon (Uhren gehen nie gleich)', () => {
      const jetzt = dayjs.utc('2026-10-25 01:47:00');
      expect(utcVon('0250', { jetzt, art: ereignis })).toBe('2026-10-25 01:50:00');
    });

    it('Ereignis: um die erste 02:20 stehen beide 02:50 bevor, es gilt gestern', () => {
      expect(utcVon('0250', { jetzt: herbstErstes, art: ereignis })).toBe('2026-10-24 00:50:00');
      expect(hinweis('0250', { jetzt: herbstErstes, art: ereignis })).toBe('gestern');
    });

    it('Ereignis: Tag und Uhrzeit ohne Monat folgen derselben Richtung', () => {
      expect(utcVon('250250', { jetzt: herbstDanach, art: ereignis })).toBe('2026-10-25 01:50:00');
    });

    it('Frist: vor der Umstellung ist „0250“ die erste 02:50', () => {
      const jetzt = dayjs.utc('2026-10-24 23:30:00'); // 01:30 Sommerzeit
      expect(utcVon('0250', { jetzt, art: frist })).toBe('2026-10-25 00:50:00');
    });

    it('Frist: um die zweite 02:20 ist die erste 02:50 vorbei, es gilt die zweite', () => {
      expect(utcVon('0250', { jetzt: herbstZweites, art: frist })).toBe('2026-10-25 01:50:00');
      expect(hinweis('0250', { jetzt: herbstZweites, art: frist })).toBeUndefined();
    });

    it('Frist: um 03:20 sind beide 02:50 vorbei, es gilt morgen', () => {
      expect(utcVon('0250', { jetzt: herbstDanach, art: frist })).toBe('2026-10-26 01:50:00');
      expect(hinweis('0250', { jetzt: herbstDanach, art: frist })).toBe('morgen');
    });

    it('ohne Feldart gilt weiter die erste 02:50', () => {
      expect(utcVon('0250', { jetzt: herbstDanach })).toBe('2026-10-25 00:50:00');
    });

    it('Bezug in der zweiten Stunde: das Ende ist die zweite 02:50, nicht morgen', () => {
      const bezug = dayjs.utc('2026-10-25 01:40:00'); // 02:40 Winterzeit
      expect(utcVon('0250', { bezug })).toBe('2026-10-25 01:50:00');
    });

    // 29.03.2026: um 01:00 UTC springt die Uhr von 02:00 Winterzeit auf 03:00 Sommerzeit vor.
    /** 01:50 Winterzeit. */
    const fruehjahrDavor = dayjs.utc('2026-03-29 00:50:00');
    /** 03:20 Sommerzeit. */
    const fruehjahrDanach = dayjs.utc('2026-03-29 01:20:00');

    it('Ereignis: eine Uhrzeit vor der Lücke ist eindeutig', () => {
      expect(utcVon('0150', { jetzt: fruehjahrDanach, art: ereignis })).toBe('2026-03-29 00:50:00');
    });

    it('Ereignis: „0230“ liegt nach vorn gerückt noch voraus, es gilt um die Lücke früher', () => {
      expect(utcVon('0230', { jetzt: fruehjahrDanach, art: ereignis })).toBe('2026-03-29 00:30:00');
    });

    it('Ereignis: liegt „0230“ nach vorn gerückt schon zurück, gilt das', () => {
      const jetzt = dayjs.utc('2026-03-29 02:00:00'); // 04:00 Sommerzeit
      expect(utcVon('0230', { jetzt, art: ereignis })).toBe('2026-03-29 01:30:00');
    });

    it('Frist: „0230“ rückt um die Lücke nach vorn, nie früher', () => {
      expect(utcVon('0230', { jetzt: fruehjahrDavor, art: frist })).toBe('2026-03-29 01:30:00');
      expect(utcVon('0230', { jetzt: fruehjahrDanach, art: frist })).toBe('2026-03-29 01:30:00');
    });

    it('Frist: ist auch die nach vorn gerückte Zeit vorbei, gilt morgen', () => {
      const jetzt = dayjs.utc('2026-03-29 01:40:00'); // 03:40 Sommerzeit
      expect(utcVon('0230', { jetzt, art: frist })).toBe('2026-03-30 00:30:00');
    });
  });

  describe('leer und Unlesbares', () => {
    it('leer ist kein Zeitpunkt', () => {
      expect(utcVon('')).toBe('∅');
      expect(utcVon('   ')).toBe('∅');
    });

    it.each(['abc', '14:3x', '1430 uhr', '--5', '10.10.'])('„%s“ ist nicht lesbar', (t) => {
      expect(utcVon(t)).toBe('✗ nicht lesbar');
    });
  });

  describe('nur Tag', () => {
    const o = { nurTag: true };
    it.each(['24.10.2026', '24.10.26', '24.10.', '2026-10-24'])(
      '„%s“ ist 24.10.2026 00:00',
      (t) => {
        expect(utcVon(t, o)).toBe('2026-10-23 22:00:00');
      },
    );

    it('nimmt keine Uhrzeit', () => {
      expect(utcVon('1430', o)).toBe('✗ nicht lesbar');
    });
  });

  it('ohne gültige Zone gilt die Browserzone', () => {
    const d: Dayjs | null = (() => {
      const r = deute('1430', { zone: 'Mars/Olympus' });
      return r.ok ? r.zeitpunkt : null;
    })();
    expect(d?.utc().format('HH:mm')).toBe('14:30');
  });
});
