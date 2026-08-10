/**
 * Merkt die zuletzt besuchten Module eines Einsatzes (LFH-337 · Befunde H12/M11).
 *
 * JE EINSATZ, nicht global — anders als `navPersistenz.ts`, das bewusst browserweit
 * merkt, ob das Panel eingeklappt ist. Der Unterschied hat einen Grund: „Panel zu" ist
 * eine Vorliebe der Person, „zuletzt in Personen und ETB" ist eine Eigenschaft der Lage.
 * Ein Einsatzwechsel darf die Abkürzungen des vorigen Einsatzes nicht mitschleppen.
 * Präzedenz für den einsatzgebundenen Schlüssel: `pages/uhs/uhsAuswahl.ts`.
 *
 * Schreibweise des Schlüssels nach `lfh:nav:eingeklappt` (`navPersistenz.ts`) — die
 * Doppelpunkt-Form ist im Bestand die häufigere.
 *
 * Jeder Zugriff liegt in `try`/`catch`: im Privatmodus wirft der Speicher, und eine
 * vergessene Abkürzung ist kein Grund, den Einsatz-Rahmen abstürzen zu lassen.
 */

/** Höchstzahl gemerkter Module. Drei ist die Zahl aus dem Ticket: genug für einen
 *  Arbeitsrhythmus, kurz genug, dass die Zeile keine zweite Modulliste wird. */
export const ZULETZT_MAX = 3;

const schluessel = (einsatzId: number) => `lfh:nav:zuletzt:${einsatzId}`;

/**
 * Merkt einen Besuch. Der Eintrag rutscht nach vorn; eine bestehende Nennung wird
 * entfernt statt verdoppelt — sonst füllte ein Hin-und-Her zwischen zwei Modulen die
 * Liste mit Kopien und verdrängte das dritte Ziel.
 */
export function merkeModulBesuch(einsatzId: number, modulKey: string): void {
  try {
    const liste = [modulKey, ...leseZuletztModule(einsatzId).filter((k) => k !== modulKey)].slice(
      0,
      ZULETZT_MAX,
    );
    localStorage.setItem(schluessel(einsatzId), JSON.stringify(liste));
  } catch {
    /* Speicher gesperrt (Privatmodus) — ohne Persistenz weiterarbeiten */
  }
}

/**
 * Liest die gemerkten Modulschlüssel, jüngstes zuerst.
 *
 * Die Formprüfung ist nicht Zierde: `JSON.parse` gelingt auch bei `42` oder `{"a":1}`,
 * und ein `.slice` darauf liefe als TypeError mitten im Render-Pfad der Navigation.
 * Fremder oder kaputter Inhalt gilt deshalb als „nichts gemerkt".
 */
export function leseZuletztModule(einsatzId: number): string[] {
  try {
    const roh = localStorage.getItem(schluessel(einsatzId));
    if (!roh) return [];
    const wert: unknown = JSON.parse(roh);
    if (!Array.isArray(wert)) return [];
    return wert.filter((k): k is string => typeof k === 'string').slice(0, ZULETZT_MAX);
  } catch {
    return [];
  }
}
