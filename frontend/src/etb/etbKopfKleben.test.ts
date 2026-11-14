import { describe, expect, it } from 'vitest';
import {
  ETB_FILTERLEISTE_HOEHE,
  ETB_KOPF_UNTERKANTE_WERT,
  ETB_SEITENKOPF_HOEHE,
  KLEBEN_HOECHSTENS,
  kopfKlebtImFenster,
} from './etbKopfKleben';

describe('Kleben der ETB-Köpfe (kwc2yszv D8)', () => {
  it('klebt am Fükw: Rahmen, Seitenkopf, Filterleiste und Spaltenkopf nehmen ein Fünftel', () => {
    // 1440 × 900 kompakt: Kopfleiste 52, Seitenkopf 44, Filterleiste 60, Spaltenkopf 26.
    expect(
      kopfKlebtImFenster({
        rahmen: 52,
        seitenkopf: 44,
        filterleiste: 60,
        spaltenkopf: 26,
        fenster: 900,
      }),
    ).toBe(true);
  });

  it('klebt nicht, wenn die Köpfe mehr als ein Drittel der Fensterhöhe nähmen', () => {
    // 1366 × 520 im Handschuh-Betrieb: oben und unten klebend bliebe der Zeitachse kein Platz,
    // ein getabbtes Ziel läge ganz verdeckt (`e2e/fokus-verdeckung.spec.ts`).
    expect(KLEBEN_HOECHSTENS).toBeCloseTo(1 / 3);
    expect(
      kopfKlebtImFenster({
        rahmen: 72,
        seitenkopf: 72,
        filterleiste: 170,
        spaltenkopf: 0,
        fenster: 520,
      }),
    ).toBe(false);
  });

  it('die Grenze gilt einschließlich', () => {
    expect(
      kopfKlebtImFenster({
        rahmen: 0,
        seitenkopf: 100,
        filterleiste: 200,
        spaltenkopf: 0,
        fenster: 900,
      }),
    ).toBe(true);
    expect(
      kopfKlebtImFenster({
        rahmen: 1,
        seitenkopf: 100,
        filterleiste: 200,
        spaltenkopf: 0,
        fenster: 900,
      }),
    ).toBe(false);
  });

  it('die Unterkante für den Spaltenkopf rechnet Rahmen, Seitenkopf und Filterleiste', () => {
    expect(ETB_KOPF_UNTERKANTE_WERT).toBe(
      `calc(var(--lfh-rahmen-oben, 0px) + var(${ETB_SEITENKOPF_HOEHE}, 0px) + var(${ETB_FILTERLEISTE_HOEHE}, 0px))`,
    );
  });
});
