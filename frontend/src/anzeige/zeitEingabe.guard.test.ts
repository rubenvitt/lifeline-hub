/**
 * Zeiteingabe-Guard (LFH-692, LLH-1070, Spec `zeiteingabe`; Regel: `frontend/AGENTS.md`,
 * „Zeiteingabe in der Anzeigezone“).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Ein nackter antd-`DatePicker` zeigt und liest die Zone des Browsers, die Anzeige aber die der
 * Organisation. Weichen beide ab, verschiebt ein „korrigierter“ Zeitpunkt still um den Versatz —
 * ohne Fehlermeldung, auch im ETB. Deshalb laufen Zeiteingaben nur über `ZeitpunktEingabe`/
 * `ZeitraumEingabe`, und `.local()` (Wanduhr der Browserzone) bleibt im Wandlungskern.
 *
 * Seit LLH-1070 ist die Zeiteingabe ein Textfeld mit eigenem Parser; antds `DatePicker` und
 * `TimePicker` gibt es nirgends mehr (ihre Scrollspalten und das „OK“ je Feld waren der Grund des
 * Umbaus), antds `Calendar` nur als Nebenweg in `anzeige/`. Ein `format` am Baustein gibt es nicht:
 * das Feld zeigt immer die DTG (`openspec/changes/ri685cfi-zeiteingabe-tippen-schnellwahl/design.md`,
 * D8, D9).
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Er liest Quelltext, keine Laufzeit: ein `dayjs().format('HH:mm')` in einem Text fängt er nicht
 * (die bewussten Gerätezeiten — Uhr und Datenstand im Kopf — stehen unter „Non-Goals“ in
 * `openspec/changes/archive/2026-10-01-lfh-692-zeiteingabe-anzeigezone/design.md`).
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

/** `DatePicker` (auch `DatePicker.RangePicker`) oder `TimePicker` aus `antd` importiert. */
const PICKER_IMPORT = /import\s*\{[^}]*\b(?:DatePicker|TimePicker)\b[^}]*\}\s*from\s*['"]antd['"]/;

/** `Calendar` aus `antd` importiert. */
const KALENDER_IMPORT = /import\s*\{[^}]*\bCalendar\b[^}]*\}\s*from\s*['"]antd['"]/;

/** Ein `format=` an einem der Bausteine (über mehrere Zeilen der Props hinweg). */
const FORMAT_AM_BAUSTEIN = /<(?:ZeitpunktEingabe|ZeitraumEingabe)\b(?:=>|[^>])*?\bformat=/;

/** Ein Aufruf `.local()` — die Wanduhr der Browserzone. */
const LOKAL = /\.local\(\)/;

describe('Zeiteingabe nur über die Bausteine in anzeige/ (LFH-692)', () => {
  it('kein antd-DatePicker oder -TimePicker, auch nicht in anzeige/', () => {
    const treffer = produktiv
      .filter(([, inhalt]) => PICKER_IMPORT.test(inhalt))
      .map(([pfad]) => pfad)
      .sort();
    expect(treffer).toEqual([]);
  });

  it('antds Kalender nur in anzeige/', () => {
    const treffer = produktiv
      .filter(([pfad, inhalt]) => !BAUSTEIN_ORT.test(pfad) && KALENDER_IMPORT.test(inhalt))
      .map(([pfad]) => pfad)
      .sort();
    expect(treffer).toEqual([]);
  });

  it('kein `format=` an ZeitpunktEingabe/ZeitraumEingabe', () => {
    const treffer = produktiv
      .filter(([, inhalt]) => FORMAT_AM_BAUSTEIN.test(inhalt))
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
    expect(KALENDER_IMPORT.test(dateien['/src/anzeige/ZeitKalender.tsx'])).toBe(true);
    // Die Muster greifen, wo sie sollen (sonst prüften die Fälle oben ins Leere).
    expect(PICKER_IMPORT.test("import { Button, DatePicker } from 'antd';")).toBe(true);
    expect(
      FORMAT_AM_BAUSTEIN.test('<ZeitpunktEingabe\n  aria-label="x"\n  format="DD.MM.YYYY"'),
    ).toBe(true);
    // Auch hinter einer Pfeilfunktion in den Props (`=>` enthält ein `>`).
    expect(
      FORMAT_AM_BAUSTEIN.test(
        '<ZeitpunktEingabe\n  onChange={(d) => setze(d)}\n  format="DD.MM.YYYY"',
      ),
    ).toBe(true);
  });
});
