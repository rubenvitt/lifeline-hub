import { describe, expect, it } from 'vitest';
import { theme as antdTheme } from 'antd';
import { antdToken, farbenDunkel, type Dichte } from '../../theme/tokens';
import {
  DREI_SPALTEN_SOCKEL,
  dreiSpaltenPassen,
  markenZielStil,
  seitlicherUeberlauf,
} from './grundrissLayout';

/** Der von antd aufgelöste Token einer Dichtestufe (Muster `theme/tokens.test.ts`). */
function token(dichte: Dichte) {
  return antdTheme.getDesignToken({ token: antdToken(farbenDunkel, dichte) });
}

describe('dreiSpaltenPassen — Umschaltpunkt nach Inhaltsbreite (LFH-970)', () => {
  it('rechnet zwei 240-px-Seitenspalten, zwei 12-px-Lücken, den Rand und die Bildlaufleiste', () => {
    // 2 × 240 + 2 × 12 + 2 × 1 px gestrichelter Rand + 17 px klassische Bildlaufleiste.
    expect(DREI_SPALTEN_SOCKEL).toBe(523);
  });

  it('stellt die Mindestfläche von 700 px erst ab 1223 px Rahmenbreite nebeneinander', () => {
    expect(dreiSpaltenPassen(1222, 700)).toBe(false);
    expect(dreiSpaltenPassen(1223, 700)).toBe(true);
  });

  it('wächst mit der Fläche: ein Platz weiter rechts verlangt mehr Rahmen', () => {
    // Die Fläche aus `Grundriss` ist `max(700, maxX + 160, Planrand)`.
    expect(dreiSpaltenPassen(1300, 900)).toBe(false);
    expect(dreiSpaltenPassen(1423, 900)).toBe(true);
  });

  /**
   * Der Befund: Tablet quer (1180 px Fenster) und ein Fükw mit 1366 px liegen über `lg`, der
   * Rahmen neben Rail und Modulpanel aber darunter. Die Fensterbreite darf nicht entscheiden.
   */
  it('nimmt bei 1180 und 1366 px Fenster neben Rail und Modulpanel die Reiterform', () => {
    const railUndPanel = 60 + 208;
    expect(dreiSpaltenPassen(1180 - railUndPanel, 700)).toBe(false);
    expect(dreiSpaltenPassen(1366 - railUndPanel, 700)).toBe(false);
  });

  it('nimmt ohne Messung (Breite 0, etwa vor dem ersten Layout) die Reiterform', () => {
    expect(dreiSpaltenPassen(0, 700)).toBe(false);
  });
});

describe('seitlicherUeberlauf — Hinweis auf weitere Plätze (LFH-970)', () => {
  it('meldet rechts Überlauf, solange der rechte Rand nicht erreicht ist', () => {
    expect(seitlicherUeberlauf({ scrollLeft: 0, clientWidth: 400, scrollWidth: 700 })).toEqual({
      links: false,
      rechts: true,
    });
  });

  it('meldet links Überlauf, sobald gescrollt ist, und rechts keinen mehr am Ende', () => {
    expect(seitlicherUeberlauf({ scrollLeft: 300, clientWidth: 400, scrollWidth: 700 })).toEqual({
      links: true,
      rechts: false,
    });
  });

  it('meldet nichts, wenn die Fläche passt', () => {
    expect(seitlicherUeberlauf({ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 })).toEqual({
      links: false,
      rechts: false,
    });
  });

  it('übersieht Rundungsreste unter einem Pixel (Zoom, gebrochene Breiten)', () => {
    expect(
      seitlicherUeberlauf({ scrollLeft: 299.6, clientWidth: 400, scrollWidth: 700 }).rechts,
    ).toBe(false);
  });
});

describe('markenZielStil — Trefffläche der Personenmarke in Listen (LFH-970)', () => {
  // Böden als Literale (`frontend/AGENTS.md`, „Handgebautes Bedienziel“): wer auf die 26-px-Marke
  // zurückfällt oder den Boden an ein anderes Token hängt, wird hier rot.
  const boeden: [Dichte, number][] = [
    ['kompakt', 30],
    ['komfortabel', 48],
    ['handschuh', 72],
  ];

  for (const [dichte, boden] of boeden) {
    it(`${dichte}: mindestens ${boden} px hoch, mit Polster aus Tokens`, () => {
      const t = token(dichte);
      const stil = markenZielStil(t);
      expect(stil.minHeight).toBeGreaterThanOrEqual(boden);
      expect(stil.minHeight).toBe(t.controlHeight);
      expect(stil.paddingBlock).toBe(t.paddingXXS);
      expect(stil.display).toBe('flex');
    });
  }

  it('füllt die Zeile neben dem Verbleib-Knopf, statt auf Inhaltsbreite zu schrumpfen', () => {
    const stil = markenZielStil(token('kompakt'));
    expect(stil.flex).toBe('1 1 auto');
    expect(stil.minWidth).toBe(0);
  });
});
