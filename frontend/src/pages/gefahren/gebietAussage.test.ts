import { describe, expect, it } from 'vitest';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import { gebietAussage, gebietEtikett } from './gebietAussage';

const b = (
  gefahrentyp: Gefahrentyp,
  warnstufe: Warnstufe,
  schutzobjekt: Schutzobjekt = 'menschen',
): GefahrBewertung => ({ gefahrentyp, schutzobjekt, warnstufe }) as GefahrBewertung;

const beurteilt = { beurteilt_at: '2026-10-20 13:15:00' };

/**
 * Zusatz der Gebietszeile (LLH-1102): statt „1 Zone“ die Zahl gesetzter Gefahren und die höchste
 * Stufe. Eine offene Beurteilung trägt das Etikett der Stufe selbst („hoch · unbestätigt“,
 * LLH-1745), der Zusatz entfällt dann.
 */
describe('gebietAussage (LLH-1102)', () => {
  it('zählt Gefahren, nicht Zellen, und nennt die höchste Stufe', () => {
    expect(
      gebietAussage(beurteilt, [
        b('brand', 'mittel', 'menschen'),
        b('brand', 'hoch', 'sachwerte'),
        b('ertrinken', 'niedrig'),
        b('explosion', 'mittel'),
      ]),
    ).toBe('3 Gefahren · hoch');
  });

  /** LLH-1365: das Lagebild zeigt eine Erläuterung zu „keine“ als Zeile, die Zählung nicht. */
  it('zählt eine Erläuterung zu „keine“ nicht als Gefahr', () => {
    const geprueft = {
      ...b('elektrizitaet', 'keine'),
      beschreibung: 'Geprüft, kein Strom im Keller.',
    };
    expect(gebietAussage(beurteilt, [geprueft])).toBe('0 Gefahren');
    expect(gebietAussage(beurteilt, [geprueft, b('brand', 'mittel')])).toBe('1 Gefahr · mittel');
  });

  it('Einzahl bei einer Gefahr', () => {
    expect(gebietAussage(beurteilt, [b('brand', 'akut')])).toBe('1 Gefahr · akut');
  });

  it('„keine“ zählt nicht: eine beurteilte Matrix ohne Gefahr ist ein Befund', () => {
    expect(gebietAussage(beurteilt, [])).toBe('0 Gefahren');
    expect(gebietAussage(beurteilt, [b('brand', 'keine')])).toBe('0 Gefahren');
  });

  it('ein unbestätigtes Gebiet hat keinen Zusatz — das Etikett der Stufe trägt es (LLH-1745)', () => {
    expect(gebietAussage({}, [b('brand', 'hoch')])).toBeNull();
    expect(gebietAussage({}, undefined)).toBeNull();
  });

  it('erfindet keine Zahl, solange die Matrix fehlt', () => {
    expect(gebietAussage(beurteilt, undefined)).toBeNull();
  });
});

describe('gebietEtikett (LLH-1745)', () => {
  it('führt Stufe und „unbestätigt“ in einem Etikett zusammen, Rolle der Stufe bleibt', () => {
    const e = gebietEtikett({ hoechste_warnstufe: 'hoch' });
    expect(e.label).toBe('hoch · unbestätigt');
    expect(e.rolle).toBe(gebietEtikett({ hoechste_warnstufe: 'hoch', ...beurteilt }).rolle);
  });

  it('auch bei Stufe keine: ein offenes Gebiet sieht nicht wie eine Entwarnung aus', () => {
    expect(gebietEtikett({ hoechste_warnstufe: 'keine' }).label).toBe('keine · unbestätigt');
  });

  it('ein bestätigtes Gebiet trägt nur die Stufe', () => {
    expect(gebietEtikett({ hoechste_warnstufe: 'hoch', ...beurteilt }).label).toBe('hoch');
  });
});
