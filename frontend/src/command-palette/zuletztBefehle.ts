/**
 * Der reine Kern des Befehls-Gedächtnisses (LFH-391 · Etappe D).
 *
 * Hier steht KEIN Netz und KEIN React — nur die Umrechnung zwischen dem opaken Serverwert
 * und der Liste von IDs. Die Verdrahtung liegt in `useZuletztBefehle.ts`, die Auflösung zu
 * Zeilen in `befehle.ts`.
 *
 * WARUM der Server und nicht `localStorage` (Entscheidung des Menschen, gegen die Empfehlung
 * des Entwurfs): das Akzeptanzkriterium lautet „pro BENUTZER persistiert". localStorage
 * merkt pro Browserprofil — auf dem gemeinsamen Fükw-Rechner wäre das Gedächtnis der
 * vorigen Schicht das der nächsten. Die übrigen Präferenzen (Theme, Dichte,
 * Koordinatenformat) bleiben bewusst lokal; ihr Umzug wäre ein eigenes Ticket über ALLE
 * Präferenzen.
 *
 * DASSELBE GILT IM PROZESS, und das war der teurere Teil der Entscheidung (Review-Befund):
 * `logout()` räumt den Query-Cache nicht (gemessen, es gibt dafür gar keinen Mechanismus),
 * und `main.tsx` hält EINEN QueryClient für die Lebensdauer des Tabs. Ein Schichtwechsel
 * ohne Neuladen hätte der neuen Schicht deshalb das Fach der alten gezeigt — die Trennung
 * hängt am Query-Key, der die `benutzer.id` trägt (`globalKeys.benutzerEinstellungenVon`).
 */

import type { BenutzerEinstellungen } from '../api/types';

/**
 * Der Schlüssel im Präferenz-Fach. Byte-gleich zu `SCHLUESSEL_ZULETZT_BEFEHLE` in
 * `src/benutzer_einstellungen/mod.rs` — dort steht er auf einer WHITELIST, ein Tippfehler
 * hier ist also ein 400 und keine stille Schreibung in ein Fach, das niemand liest.
 */
export const SCHLUESSEL_ZULETZT_BEFEHLE = 'zuletzt_befehle';

/**
 * Höchstzahl gemerkter Befehle.
 *
 * Mehr als die drei Module aus `zuletztModule.ts`, weil die Befehlsmenge grösser ist (42+
 * gegen 24) und die Palettenliste scrollt, während die Zuletzt-Zeile im Navigationsrahmen
 * einzeilig ist. Und deutlich weniger als die rund ein Dutzend Zeilen, die der Kasten
 * (`maxHeight: min(60vh, 480px)`) zeigt: die Gruppe steht ZUOBERST, jede weitere Zeile
 * schiebt `aktionen` und `schnellaktionen` nach unten.
 */
export const ZULETZT_BEFEHLE_MAX = 5;

/**
 * Liest die gemerkten IDs aus dem Serverstand, jüngstes zuerst.
 *
 * Die Formprüfung ist nicht Zierde. Der Wert ist serverseitig ein OPAKER Text
 * (`benutzer_einstellungen.wert`, keine CHECK-Constraint, kein Typ) — `JSON.parse` gelingt
 * auch bei `42` oder `{"a":1}`, und ein `.slice` darauf liefe als TypeError mitten im Bau
 * der Befehlsliste. Dieselbe Begründung wie in `einsatz/zuletztModule.ts`, nur dass die
 * Quelle hier fremd ist statt bloss alt.
 *
 * Entdoppelt wird ebenfalls hier und nicht erst beim Rendern: `baueBefehle` klont jede ID zu
 * einer `ausgefuehrt:`-Zeile, zwei gleiche IDs ergäben zwei Knoten mit derselben `cmd-<id>`
 * — genau die Mehrdeutigkeit von `aria-activedescendant`, gegen die die Id-Präfixe existieren.
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
 * Der neue Stand nach einer Ausführung — jüngstes zuerst, gedeckelt.
 *
 * Eine bestehende Nennung wird VERSCHOBEN statt verdoppelt: sonst füllte ein Hin und Her
 * zwischen zwei Befehlen die Liste mit Kopien und verdrängte die übrigen Ziele (dieselbe
 * Regel wie `merkeModulBesuch`).
 */
export function naechsteZuletztBefehle(vorher: readonly string[], id: string): string[] {
  return [id, ...vorher.filter((x) => x !== id)].slice(0, ZULETZT_BEFEHLE_MAX);
}
