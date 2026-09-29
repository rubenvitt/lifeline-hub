import { describe, expect, it } from 'vitest';
import { rahmenFarben } from './tokens';

/**
 * Kontrast auf dem dauerdunklen Rahmen (LFH-434), GERECHNET statt behauptet (WCAG-Formel).
 *
 * Kommandoleiste und Rail sind in BEIDEN App-Modi dunkel, werden aber auch bei Tageslicht
 * gelesen. Die Schwelle aus Kriterium 5 folgt dem Umgebungslicht, nicht dem Farbtoken: bedienbarer
 * Text auf dem Rahmen hält die TAG-Schwelle ≥ 7 : 1 auf jedem Rahmengrund. Gesperrte Einträge
 * (WCAG 1.4.3 nimmt inaktive Komponenten aus) halten den Boden ≥ 4,5 : 1 und tragen die Sperre
 * zusätzlich ohne Farbe (Schloss-Ikone, `AppLayout.tsx`). Böden als Literale.
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

/** Jeder Grund, auf dem im Rahmen Text steht: Leiste/Rail, Suchfeld, aktive Rail-Zeile. */
const GRUENDE = ['grund', 'feld', 'aktiv'] as const;

describe('Rahmen — Kontrast bei Tageslicht (LFH-434)', () => {
  it.each(['text', 'gedaempft'] as const)(
    'bedienbarer Text „%s“ hält auf jedem Rahmengrund ≥ 7 : 1',
    (rolle) => {
      for (const grund of GRUENDE) {
        expect(kontrast(rahmenFarben[rolle], rahmenFarben[grund]), grund).toBeGreaterThanOrEqual(7);
      }
    },
  );

  it('„gesperrt“ hält den Boden ≥ 4,5 : 1 auf dem Leistengrund', () => {
    expect(kontrast(rahmenFarben.gesperrt, rahmenFarben.grund)).toBeGreaterThanOrEqual(4.5);
  });

  it('„gesperrt“ bleibt sichtbar schwächer als der freie Eintrag (gedaempft)', () => {
    // Die Farbe ist nicht der einzige Kanal der Sperre, aber sie darf nicht gleich aussehen.
    expect(luminanz(rahmenFarben.gedaempft) / luminanz(rahmenFarben.gesperrt)).toBeGreaterThan(1.4);
  });

  it('kennt keine Textrolle unterhalb der Tag-Schwelle außer „gesperrt“', () => {
    // Eine neue schwache Textstufe im Rahmen ist eine Entscheidung gegen LFH-434, kein Nachtrag.
    expect(Object.keys(rahmenFarben).sort()).toEqual(
      ['aktiv', 'feld', 'gedaempft', 'gesperrt', 'grund', 'linie', 'marke', 'text'].sort(),
    );
  });
});
