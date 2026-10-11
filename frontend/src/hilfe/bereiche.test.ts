import { describe, expect, it } from 'vitest';
import { KAPITEL } from './kapitel';
import { BEREICHE, bereichVon, kurztext } from './bereiche';

/**
 * Bereiche der Anwenderdokumentation (LFH-1096): jeder Hunderterblock der `reihenfolge` gehört zu
 * genau einem Bereich, und der Kurztext einer Karte ist der erste Absatz des Überblicks.
 */
describe('bereichVon', () => {
  it('ordnet die Hunderterblöcke den Bereichen zu', () => {
    expect(bereichVon(0)).toBe('Einstieg');
    expect(bereichVon(99)).toBe('Einstieg');
    expect(bereichVon(100)).toBe('Führungsmittel');
    expect(bereichVon(799)).toBe('Gekoppelte Geräte');
  });

  it('kennt jedes Kapitel in einem Bereich', () => {
    for (const k of KAPITEL) {
      expect(BEREICHE, k.slug).toContain(bereichVon(k.reihenfolge));
    }
  });
});

describe('kurztext', () => {
  it('nimmt den ersten Absatz des Überblicks ohne Auszeichnung', () => {
    const text = [
      '## Überblick',
      '',
      'Das **Modul** führt die [Schicht](ohne-netz.md) je Einheit.',
      'Zweite Zeile desselben Absatzes.',
      '',
      'Zweiter Absatz, der nicht erscheint.',
      '',
      '## Abläufe',
    ].join('\n');
    expect(kurztext(text)).toBe(
      'Das Modul führt die Schicht je Einheit. Zweite Zeile desselben Absatzes.',
    );
  });

  it('ist leer ohne Überblick', () => {
    expect(kurztext('## Abläufe\n\nText')).toBe('');
  });

  it('liefert für jedes Kapitel einen Kurztext', () => {
    for (const k of KAPITEL) {
      expect(kurztext(k.text), k.slug).not.toBe('');
    }
  });
});
