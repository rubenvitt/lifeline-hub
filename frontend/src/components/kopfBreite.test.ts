import { describe, expect, it } from 'vitest';
import {
  KOPF_TYPO,
  kopfMindestBreite,
  laengstesWort,
  mitKopfMindestBreite,
  textBreiteKopf,
} from './kopfBreite';

/** Feste Messung für die Tests: 6 px je Zeichen, Sperrung schon enthalten. */
const messen = (text: string) => text.length * 6;
const kompakt = { controlHeightSM: 24, padding: 12, fontSizeSM: 12 };
const handschuh = { controlHeightSM: 72, padding: 26, fontSizeSM: 15 };

describe('kopfMindestBreite (LLH-1788)', () => {
  it('misst das längste Wort in Versalien, nicht den ganzen Titel: ein Kopf darf umbrechen', () => {
    expect(laengstesWort('Einsatz­dauer seit')).toBe('EINSATZ­DAUER');
    expect(kopfMindestBreite({ titel: 'Status seit', token: kompakt, messen })).toBe(
      2 * 12 + 'STATUS'.length * 6,
    );
  });

  it('rechnet Sortiersymbol und Filterauslöser der Stufe dazu', () => {
    const ohne = kopfMindestBreite({ titel: 'Position', token: handschuh, messen });
    const sortierbar = kopfMindestBreite({
      titel: 'Position',
      token: handschuh,
      messen,
      sortierbar: true,
    });
    const mitFilter = kopfMindestBreite({
      titel: 'Position',
      token: handschuh,
      messen,
      sortierbar: true,
      filterbar: true,
    });
    expect(ohne).toBe(2 * 26 + 8 * 6);
    // Das Sortiersymbol wächst mit `fontSizeSM` (15 px in `handschuh`), dazu 4 px Abstand.
    expect(sortierbar - ohne).toBe(15 + 4);
    // Der Filterauslöser trägt den Boden der Stufe (72 px in `handschuh`) plus seinen Abstand.
    expect(mitFilter - sortierbar).toBe(72 + 4);
  });

  it('rundet auf ganze Pixel auf und ohne Titel zählt nur die Polsterung', () => {
    expect(kopfMindestBreite({ titel: 'ab', token: kompakt, messen: () => 10.2 })).toBe(35);
    expect(kopfMindestBreite({ titel: '', token: kompakt, messen })).toBe(24);
  });

  it('die Kopfschrift ist die des Tabellenkopfs: Stufe fein, 600, Sperrung .12em', () => {
    expect(KOPF_TYPO).toEqual({ stufe: 'fein', gewicht: 600, sperrung: 0.12 });
  });

  it('die Kopfschrift wächst mit der Dichte (LLH-1774)', () => {
    const kompakt = textBreiteKopf('EINSATZFUNKTION', '', 'kompakt');
    const handschuh = textBreiteKopf('EINSATZFUNKTION', '', 'handschuh');
    expect(handschuh).toBeGreaterThan(kompakt * 1.2);
  });
});

describe('mitKopfMindestBreite (LLH-1788)', () => {
  it('hebt Zahlbreite und Mindestmaß, senkt nie und lässt Spalten ohne Breite in Ruhe', () => {
    expect(mitKopfMindestBreite({ width: 40 }, 90)).toEqual({ width: 90 });
    expect(mitKopfMindestBreite({ width: 140 }, 90)).toEqual({ width: 140 });
    expect(mitKopfMindestBreite({ mindestBreite: 80 }, 90)).toEqual({ mindestBreite: 90 });
    expect(mitKopfMindestBreite({ width: '20%' }, 90)).toEqual({ width: '20%' });
    expect(mitKopfMindestBreite({}, 90)).toEqual({});
  });
});
