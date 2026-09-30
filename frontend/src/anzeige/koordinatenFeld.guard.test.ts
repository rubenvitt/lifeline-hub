/**
 * Koordinaten-Guard (LFH-517): eine `KoordinatenEingabe` in einem Formular kommt über
 * `KoordinatenFeld`.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Die Eingabe meldet unlesbaren Text als `ungueltig`, nicht als `null`. Nur `koordinatenRegel`
 * am `Form.Item` sperrt damit das Absenden; ein nacktes `Form.Item` ließe den Ungültig-Wert
 * bis `alsLatLon` durch, das dann wirft — statt eines Feldfehlers gäbe es eine Ausnahme.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Er prüft Importe, nicht JSX: welche Dateien die Eingabe direkt einbinden. Die Liste
 * {@link DIREKT} nennt jede bewertete Stelle; eine neue Stelle ist eine Entscheidung, ob sie ein
 * Formular ist (dann `KoordinatenFeld`) oder den Wert selbst prüft (`istLatLon`).
 */
import { describe, expect, it } from 'vitest';

// Das Glob bleibt HIER, sonst landete bei einem versehentlichen Produktiv-Import der Quelltext im
// App-Bundle.
const dateien = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Direkte Einbindungen außerhalb eines Formulars; jede prüft den Wert per `istLatLon`
 * (Verhalten belegt in `Sidebar.test.tsx`).
 */
const DIREKT = new Set([
  '/src/anzeige/KoordinatenFeld.tsx', // die Formularhülle selbst
  '/src/pages/lagekarte/Sidebar.tsx', // „Übernehmen“ und „Mittelpunkt setzen“, kein Form
]);

const IMPORT = /import\s+KoordinatenEingabe\s+from\s+['"][^'"]*\/KoordinatenEingabe['"]/;

describe('KoordinatenEingabe nur über KoordinatenFeld (LFH-517)', () => {
  const einbinder = Object.entries(dateien)
    .filter(([pfad]) => !/\.test\.tsx$/.test(pfad))
    .filter(([, inhalt]) => IMPORT.test(inhalt))
    .map(([pfad]) => pfad)
    .sort();

  it('bindet die Eingabe nur an den bewerteten Stellen direkt ein', () => {
    expect(einbinder).toEqual([...DIREKT].sort());
  });
});
