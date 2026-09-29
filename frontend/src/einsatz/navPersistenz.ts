/**
 * Merkt, ob das Modul-Panel des Einsatz-Rahmens eingeklappt ist (LFH-329).
 *
 * EIGENES BOOLEAN statt `offeneKategorie`: die gleicht der Layout-Effekt bei jedem
 * Modulwechsel an die Kategorie des Moduls an; ein darauf gestütztes „zugeklappt" klappte
 * beim nächsten Sprung wieder auf. Gemerkt wird nur, OB eine Kategorie offen ist.
 *
 * BEWUSST GLOBAL, nicht je Einsatz: mal auf, mal zu je nach Einsatz wäre Zufall statt
 * Einstellung.
 *
 * Jeder Zugriff liegt in `try`/`catch`: im Privatmodus wirft der Speicher, und eine
 * vergessene Navigation ist kein Grund, den Einsatz-Rahmen abstürzen zu lassen.
 */

const SCHLUESSEL = 'lfh:nav:eingeklappt';

/** Liest den gemerkten Zustand; ohne Eintrag (und bei gesperrtem Speicher) „offen". */
export function leseNavEingeklappt(): boolean {
  try {
    return localStorage.getItem(SCHLUESSEL) === '1';
  } catch {
    return false;
  }
}

/**
 * Merkt den Zustand. `false` ENTFERNT den Eintrag, statt `'0'` abzulegen — sonst
 * gäbe es zwei Schreibweisen für „offen" (fehlend und `'0'`), von denen der Leser
 * oben nur eine kennt.
 */
export function schreibeNavEingeklappt(eingeklappt: boolean): void {
  try {
    if (eingeklappt) localStorage.setItem(SCHLUESSEL, '1');
    else localStorage.removeItem(SCHLUESSEL);
  } catch {
    /* Speicher gesperrt (Privatmodus) — ohne Persistenz weiterarbeiten */
  }
}
