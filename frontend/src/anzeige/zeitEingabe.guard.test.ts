/**
 * Zeiteingabe-Guard (LFH-692, Spec `zeiteingabe`; Regel: `frontend/AGENTS.md`, Inline-Bearbeitung).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Ein nackter antd-`DatePicker` zeigt und liest die Zone des Browsers, die Anzeige aber die der
 * Organisation. Weichen beide ab, verschiebt ein „korrigierter“ Zeitpunkt still um den Versatz —
 * ohne Fehlermeldung, auch im ETB. Deshalb laufen Zeiteingaben nur über `ZeitpunktEingabe`/
 * `ZeitraumEingabe`, und `.local()` (Wanduhr der Browserzone) bleibt im Wandlungskern.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Er liest Quelltext, keine Laufzeit: ein `dayjs().format('HH:mm')` in einem Text fängt er nicht
 * (die bewussten Gerätezeiten — Uhr und Datenstand im Kopf — stehen unter „Non-Goals“ in
 * `openspec/changes/lfh-692-zeiteingabe-anzeigezone/design.md`).
 */
import { describe, expect, it } from 'vitest';

// Das Glob bleibt HIER, sonst landete bei einem versehentlichen Produktiv-Import der Quelltext im
// App-Bundle.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const produktiv = Object.entries(dateien).filter(([pfad]) => !/\.test\.tsx?$/.test(pfad));

/** Die Bausteine selbst; sonst nirgends. */
const BAUSTEIN_ORT = /^\/src\/anzeige\//;

/** `DatePicker` (auch `DatePicker.RangePicker`) aus `antd` importiert. */
const DATEPICKER_IMPORT = /import\s*\{[^}]*\bDatePicker\b[^}]*\}\s*from\s*['"]antd['"]/;

/** Ein Aufruf `.local()` — die Wanduhr der Browserzone. */
const LOKAL = /\.local\(\)/;

describe('Zeiteingabe nur über die Bausteine in anzeige/ (LFH-692)', () => {
  it('kein antd-DatePicker außerhalb von anzeige/', () => {
    const treffer = produktiv
      .filter(([pfad, inhalt]) => !BAUSTEIN_ORT.test(pfad) && DATEPICKER_IMPORT.test(inhalt))
      .map(([pfad]) => pfad)
      .sort();
    expect(treffer).toEqual([]);
  });

  it('kein `.local()` außerhalb von anzeige/', () => {
    const treffer = produktiv
      .filter(([pfad, inhalt]) => !BAUSTEIN_ORT.test(pfad) && LOKAL.test(inhalt))
      .map(([pfad]) => pfad)
      .sort();
    expect(treffer).toEqual([]);
  });

  it('die Bausteine selbst sind gefunden (der Guard läuft nicht ins Leere)', () => {
    const pfade = produktiv.map(([pfad]) => pfad);
    expect(pfade).toContain('/src/anzeige/ZeitpunktEingabe.tsx');
    expect(pfade).toContain('/src/anzeige/zeitEingabe.ts');
    expect(DATEPICKER_IMPORT.test(dateien['/src/anzeige/ZeitpunktEingabe.tsx'])).toBe(true);
  });
});
