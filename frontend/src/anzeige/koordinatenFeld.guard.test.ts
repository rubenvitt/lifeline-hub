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
 * Direkte Einbindungen außerhalb eines Formulars; jede prüft den Wert selbst, bevor sie ihn
 * sendet oder wandelt (Verhalten belegt in `ModusBand.test.tsx`, „ungültige Koordinate sperrt …“, und
 * `EinsatzdatenPage.test.tsx`, „unlesbare Koordinate“).
 */
const DIREKT = new Set([
  '/src/anzeige/KoordinatenFeld.tsx', // die Formularhülle selbst
  // Modus-Band der Kartenleiste: „Übernehmen“ und „Mittelpunkt setzen“, kein Form; beide Knöpfe
  // sind nur bei `istLatLon` frei.
  '/src/pages/lagekarte/ModusBand.tsx',
  // Zeile „Koordinate“ im Paneel „Einsatzort“ (LFH-1175/LFH-1170) und Standort der eigenen
  // Führungsstelle (LFH-1181): je `InlineAngabe` mit eigenem `<form>`, kein `Form.Item`; ein
  // ungültiger Wert wird vor dem Senden abgefangen (`isValid` bzw. vor `alsLatLon`).
  '/src/pages/EinsatzdatenPage.tsx',
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
