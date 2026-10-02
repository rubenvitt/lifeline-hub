import { describe, expect, it } from 'vitest';
import { kontrast, luminanz } from '../test/farbmass';
import { farbenDunkel, rahmenFarben } from './tokens';

/**
 * Kontrast auf dem dauerdunklen Rahmen (LFH-434), GERECHNET statt behauptet (WCAG-Formel).
 *
 * Kommandoleiste und Rail sind in BEIDEN App-Modi dunkel, werden aber auch bei Tageslicht
 * gelesen. Die Schwelle aus Kriterium 5 folgt dem Umgebungslicht, nicht dem Farbtoken: bedienbarer
 * Text auf dem Rahmen hält die TAG-Schwelle ≥ 7 : 1 auf jedem Rahmengrund. Gesperrte Einträge
 * (WCAG 1.4.3 nimmt inaktive Komponenten aus) halten den Boden ≥ 4,5 : 1 und tragen die Sperre
 * zusätzlich ohne Farbe (Schloss-Icon, `AppLayout.tsx`). Böden als Literale.
 */

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

  // Text im Rahmen, der nicht aus den Textstufen kommt: Einsatzname und Initialen (`text2`,
  // `EinsatzSwitcher`, `BenutzerMenu`), Zustandswörter der SYNC-Zelle und der Alarmzentrale
  // (`achtung`, `rahmenFarben.alarm`). Ein Zustandswort ist Text und hält dieselbe Schwelle.
  it.each([
    ['farbenDunkel.text2', farbenDunkel.text2],
    ['farbenDunkel.achtung', farbenDunkel.achtung],
    ['rahmenFarben.alarm', rahmenFarben.alarm],
  ])('Zustands- und Namenstext %s hält auf dem Leistengrund ≥ 7 : 1', (_name, farbe) => {
    expect(kontrast(farbe, rahmenFarben.grund)).toBeGreaterThanOrEqual(7);
  });

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
      ['aktiv', 'alarm', 'feld', 'gedaempft', 'gesperrt', 'grund', 'linie', 'marke', 'text'].sort(),
    );
  });
});
