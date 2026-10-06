/**
 * Merkt, ob jemand das Modul-Panel des Einsatz-Rahmens zu- oder aufgeklappt hat (LFH-329,
 * dreiwertig seit LFH-952: `frontend/AGENTS.md`, Rahmen).
 *
 * EIGENER WERT statt `offeneKategorie`: die gleicht der Layout-Effekt bei jedem
 * Modulwechsel an die Kategorie des Moduls an; ein darauf gestütztes „zugeklappt" klappte
 * beim nächsten Sprung wieder auf. Gemerkt wird nur, OB eine Kategorie offen ist.
 *
 * DREI WERTE: zu (`'1'`), offen (`'0'`), keine Wahl (kein Eintrag). Ohne Wahl gilt die Vorgabe
 * der Breite ({@link panelZu}): am Tablet quer zwischen `lg` und `xl` zu, damit der Inhalt Platz
 * hat, ab `xl` offen. Geschrieben wird nur, was jemand WÄHLT (Griff „Menü“, Selbstklick auf die
 * offene Kategorie), kein Rail-Sprung — sonst wäre nach dem ersten Sprung die Vorgabe weg.
 *
 * BEWUSST GLOBAL, nicht je Einsatz: mal auf, mal zu je nach Einsatz wäre Zufall statt
 * Einstellung.
 *
 * Jeder Zugriff liegt in `try`/`catch`: im Privatmodus wirft der Speicher, und eine
 * vergessene Navigation ist kein Grund, den Einsatz-Rahmen abstürzen zu lassen.
 */

const SCHLUESSEL = 'lfh:nav:eingeklappt';

/** Was jemand gewählt hat; `null` heißt: keine Wahl, die Vorgabe der Breite gilt. */
export type NavWahl = 'zu' | 'offen';

/** Liest die gemerkte Wahl; ohne (lesbaren) Eintrag und bei gesperrtem Speicher `null`. */
export function leseNavWahl(): NavWahl | null {
  try {
    const wert = localStorage.getItem(SCHLUESSEL);
    if (wert === '1') return 'zu';
    if (wert === '0') return 'offen';
    return null;
  } catch {
    return null;
  }
}

/** Merkt eine Wahl. Es gibt kein „Wahl löschen“: wer gewählt hat, bekommt seine Wahl. */
export function schreibeNavWahl(wahl: NavWahl): void {
  try {
    localStorage.setItem(SCHLUESSEL, wahl === 'zu' ? '1' : '0');
  } catch {
    /* Speicher gesperrt (Privatmodus) — ohne Persistenz weiterarbeiten */
  }
}

/** Ob das Panel zu ist: die Wahl, sonst die Vorgabe (`weit` = ab `xl` offen). */
export function panelZu(wahl: NavWahl | null, weit: boolean): boolean {
  return wahl === null ? !weit : wahl === 'zu';
}
