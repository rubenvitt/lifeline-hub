/**
 * Merkt, ob das Modul-Panel des Einsatz-Rahmens eingeklappt ist (LFH-329 · B1/H11).
 *
 * WARUM EIN EIGENES BOOLEAN UND NICHT `offeneKategorie`: die Zustandsvariable im
 * Layout trug bis hierher zwei Bedeutungen in einer — WELCHE Kategorie offen ist
 * und OB überhaupt eine offen ist. Der Effekt, der das Panel beim Navigieren an
 * die Kategorie des aktuellen Moduls angleicht, überschreibt sie bei jedem
 * Modulwechsel; ein darauf gestütztes „zugeklappt" klappte also beim ersten
 * Sprung in eine andere Kategorie wieder auf. Die beiden Bedeutungen sind
 * deshalb getrennt, und nur die zweite wird gemerkt.
 *
 * BEWUSST GLOBAL, nicht je Einsatz: der Rahmen ist einsatzunabhängig: mal auf,
 * mal zu, je nachdem welcher Einsatz gerade offen ist, wäre für den Benutzer
 * Zufall statt Einstellung.
 *
 * Schreibweise des Schlüssels nach `lfh:alarm:mute` (`alarm/alarmTon.ts`), nicht
 * nach der Punktform aus `theme/ThemeModeProvider.tsx` — die Doppelpunkt-Form ist
 * im Bestand die häufigere. Jeder Zugriff liegt in `try`/`catch`: im Privatmodus
 * wirft der Speicher, und eine vergessene Navigation ist kein Grund, den
 * Einsatz-Rahmen abstürzen zu lassen.
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
