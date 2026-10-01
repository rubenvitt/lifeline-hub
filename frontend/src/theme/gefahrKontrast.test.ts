import { describe, expect, it } from 'vitest';
import { antdKomponenten, farbenDunkel, farbenHell } from './tokens';

/**
 * Gefahrrot als Text und Beschriftung auf Gefahrfläche, GERECHNET statt behauptet (WCAG-Formel).
 *
 * LFH-693, Spec `farbrollen-kontrast`: der rote Menüeintrag, der gefüllte und der umrandete
 * Gefahrknopf halten den Textboden aus Kriterium 5, Tag ≥ 7 : 1, Nacht ≥ 5 : 1, in Ruhe, unter
 * dem Zeiger und (gefüllt) beim Drücken. Die Farben kommen aus den KOMPONENTEN-Tokens, nicht aus
 * den Rollen: ein vergessenes Token muss hier rot werden. Böden als Literale; der
 * Browser-Nachweis steht in `e2e/gefahr-kontrast.spec.ts`.
 */
function luminanz(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontrast(a: string, b: string): number {
  const [x, y] = [luminanz(a), luminanz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Ein Komponenten-Token als Hex; fehlt es, ist das ein Befund, kein Rückfall auf antd. */
function token(quelle: object | undefined, name: string): string {
  const wert = (quelle as Record<string, unknown> | undefined)?.[name];
  if (typeof wert !== 'string') throw new Error(`Komponenten-Token ${name} fehlt`);
  return wert;
}

describe.each([
  ['Tag', farbenHell, 7],
  ['Nacht', farbenDunkel, 5],
] as const)('Gefahrrot — %s (LFH-693)', (_modus, farben, boden) => {
  const { Dropdown, Button } = antdKomponenten(farben, 'kompakt');

  it('roter Menüeintrag in Ruhe auf der Menüfläche', () => {
    expect(kontrast(token(Dropdown, 'colorError'), farben.flaeche2)).toBeGreaterThanOrEqual(boden);
  });

  it('roter Menüeintrag unter dem Zeiger auf seiner roten Hinterlegung', () => {
    expect(
      kontrast(token(Dropdown, 'colorTextLightSolid'), token(Dropdown, 'colorError')),
    ).toBeGreaterThanOrEqual(boden);
  });

  it.each(['colorError', 'colorErrorHover', 'colorErrorActive'])(
    'gefüllter Gefahrknopf: Beschriftung auf %s',
    (flaeche) => {
      expect(kontrast(token(Button, 'dangerColor'), token(Button, flaeche))).toBeGreaterThanOrEqual(
        boden,
      );
    },
  );

  it.each(['colorError', 'colorErrorHover'])(
    'umrandeter Gefahrknopf: Beschriftung %s auf der Knopffläche',
    (schrift) => {
      expect(kontrast(token(Button, schrift), farben.flaeche)).toBeGreaterThanOrEqual(boden);
    },
  );

  // Der Gefahrknopf ohne Rahmen (`type="text"`) steht auf dem Seitengrund. Hier scheiterte ein
  // Zeigerton HELLER als die Ruhe (`#a11f14`: 6,46 am Tag) — deshalb dunkelt `alarmHover`.
  it.each(['colorError', 'colorErrorHover'])(
    'Gefahrknopf ohne Rahmen: Beschriftung %s auf dem Seitengrund',
    (schrift) => {
      expect(kontrast(token(Button, schrift), farben.grund)).toBeGreaterThanOrEqual(boden);
    },
  );

  it('die Gefahrfläche unter dem Zeiger unterscheidet sich von der Ruhe', () => {
    expect(token(Button, 'colorErrorHover').toLowerCase()).not.toBe(
      token(Button, 'colorError').toLowerCase(),
    );
  });
});
