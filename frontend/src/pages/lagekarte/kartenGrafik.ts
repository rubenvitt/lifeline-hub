/**
 * Lagekarte auf einem Gerät ohne Kartengrafik (LLH-1353, `lagekarte/AGENTS.md`, „Karte ohne
 * Grafik“): maplibre braucht WebGL2. Fehlt es, wirft der Konstruktor der Karte eine
 * `GPUInitializationError`; die Kartenfläche fängt genau diesen Wurf und zeigt den Zustand, statt
 * die Seite in die Fehlerseite der App zu reißen.
 */

/** Zustand an Stelle der Karte und Grund eines gescheiterten Lageplans. Keine Technik im Text. */
export const KARTE_NICHT_DARSTELLBAR = 'Karte auf diesem Gerät nicht darstellbar';

/**
 * Ist das der Wurf des Kartenkonstruktors ohne Grafik? Über den Namen, den maplibre ausdrücklich
 * setzt, nicht über `instanceof`: Test-Nachbauten von maplibre exportieren die Klasse nicht. Jeder
 * andere Fehler bleibt ein Fehler.
 */
export function isGrafikFehler(fehler: unknown): boolean {
  return fehler instanceof Error && fehler.name === 'GPUInitializationError';
}

/** Baut die Karte; `null`, wenn das Gerät keine Kartengrafik hat. Jeder andere Wurf fliegt weiter. */
export function wennDarstellbar<T>(baue: () => T): T | null {
  try {
    return baue();
  } catch (fehler) {
    if (isGrafikFehler(fehler)) return null;
    throw fehler;
  }
}
