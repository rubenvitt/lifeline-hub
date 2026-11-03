import { describe, expect, it } from 'vitest';
import bereiche from '../../../website/src/daten/module.json';
import { kategorien, modulRegistry } from './modulRegistry';

/**
 * Wächter der Modulliste der Website (LLH-1378, `website/AGENTS.md`, „Kopien statt zweiter
 * Quelle“).
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * Die Website baut ohne die App und führt deshalb eine eigene Kopie der Module
 * (`website/src/daten/module.json`). Seit dem 08.10.2026 fehlten dort Lagebesprechung, Evakuierung
 * und Fernmeldewesen, und Stab und Betreuung trugen alte Beschreibungen; niemand hat es bemerkt,
 * weil keine Prüfung beide Listen nebeneinanderlegte.
 *
 * ── Was er prüft ───────────────────────────────────────────────────────────────
 * Die Kopie gleicht der Registry: dieselben Bereiche (`Kategorie.label`) in derselben
 * Reihenfolge, je Bereich dieselben Module mit gleichem Namen und gleicher Beschreibung in
 * Registry-Reihenfolge. Es zählen nur Module mit Status `fertig`; die Kategorie am Fuß der Rail
 * (Einstellungen) steht nicht auf der Website.
 *
 * Gelesen wird die JSON-Datei, nicht `module.ts`: eine `.ts`-Datei unter `website/` übersetzte
 * Vitest mit `website/tsconfig.json`, deren Basis ohne `website/node_modules` fehlt (CI).
 */
describe('Modulliste der Website (LLH-1378)', () => {
  it('gleicht der App-Registry in Bereich, Name, Beschreibung und Reihenfolge', () => {
    const erwartet = kategorien
      .filter((kategorie) => !kategorie.fuss)
      .map((kategorie) => ({
        name: kategorie.label,
        module: modulRegistry
          .filter((modul) => modul.kategorie === kategorie.key && modul.status === 'fertig')
          .map((modul) => ({ name: modul.label, beschreibung: modul.beschreibung })),
      }));

    expect(bereiche).toEqual(erwartet);
  });
});
