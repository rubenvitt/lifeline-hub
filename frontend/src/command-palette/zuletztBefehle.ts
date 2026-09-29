/**
 * Der reine Kern des Befehls-Gedächtnisses: kein Netz, kein React, nur die Umrechnung zwischen
 * dem opaken Serverwert und der ID-Liste. Verdrahtung in `useZuletztBefehle.ts`, Auflösung zu
 * Zeilen in `befehle.ts`.
 *
 * Der Server statt `localStorage`, weil pro BENUTZER persistiert wird: localStorage merkt pro
 * Browserprofil, am gemeinsamen Fükw-Rechner erbte die nächste Schicht das Gedächtnis der
 * vorigen. Im Prozess trennt der Query-Key mit `benutzer.id`
 * (`globalKeys.benutzerEinstellungenVon`), weil `logout()` den Cache nicht räumt.
 */

import type { BenutzerEinstellungen } from '../api/types';

/**
 * Der Schlüssel im Präferenz-Fach, byte-gleich zu `SCHLUESSEL_ZULETZT_BEFEHLE` in
 * `src/benutzer_einstellungen/mod.rs` (WHITELIST: ein Tippfehler ist ein 400).
 */
export const SCHLUESSEL_ZULETZT_BEFEHLE = 'zuletzt_befehle';

/**
 * Höchstzahl gemerkter Befehle: die Gruppe steht ZUOBERST, jede weitere Zeile schiebt
 * `aktionen` und `schnellaktionen` nach unten.
 */
export const ZULETZT_BEFEHLE_MAX = 5;

/**
 * Liest die gemerkten IDs aus dem Serverstand, jüngstes zuerst.
 *
 * Die Formprüfung trägt: der Wert ist serverseitig OPAKER Text, `JSON.parse` gelingt auch bei
 * `42`, und ein `.slice` darauf würfe mitten im Bau der Befehlsliste. Entdoppelt wird hier, weil
 * zwei gleiche IDs zwei Knoten mit derselben `cmd-<id>` ergäben.
 */
export function leseZuletztBefehle(stand: BenutzerEinstellungen | undefined): string[] {
  const roh = stand?.eintraege?.[SCHLUESSEL_ZULETZT_BEFEHLE];
  if (!roh) return [];
  let wert: unknown;
  try {
    wert = JSON.parse(roh);
  } catch {
    return [];
  }
  if (!Array.isArray(wert)) return [];
  const gesehen = new Set<string>();
  const ids: string[] = [];
  for (const eintrag of wert) {
    if (typeof eintrag !== 'string' || gesehen.has(eintrag)) continue;
    gesehen.add(eintrag);
    ids.push(eintrag);
    if (ids.length === ZULETZT_BEFEHLE_MAX) break;
  }
  return ids;
}

/**
 * Der neue Stand nach einer Ausführung, jüngstes zuerst, gedeckelt. Eine bestehende Nennung wird
 * VERSCHOBEN statt verdoppelt, wie bei `merkeModulBesuch`.
 */
export function naechsteZuletztBefehle(vorher: readonly string[], id: string): string[] {
  return [id, ...vorher.filter((x) => x !== id)].slice(0, ZULETZT_BEFEHLE_MAX);
}
