import type { Staerke } from '../api/types';

/**
 * Zahlen eines Bereitstellungsraums, die im Client entstehen (LLH-1095 D1, Spec
 * `bereitstellungsraum-belegung`). Seitenfrei, weil Liste, Detailseite und die Lagekarte
 * (LLH-1107) dieselbe Rechnung brauchen. Fahrzeuge, Einheiten und längste Wartezeit rechnet der
 * Server (`belegung`), nur die Stärke bleibt hier (`frontend/AGENTS.md`, „Eine Heimat je Zahl“).
 *
 * DIE STÄRKE IM RAUM ZÄHLT NUR, WAS IM RAUM STEHT (LLH-1289): jede Einheit des Raums mit ihrer
 * eigenen Ist-Stärke (`ist`), nicht mit der kumulierten (`ist_kumuliert`). Steht der „1. Zug“ im
 * BR Sportplatz und seine „Gruppe 2“ im BR Schule, zählt die Gruppe nur im BR Schule; sonst stünde
 * sie in beiden Räumen und auf der Lagekarte doppelt. So zählt die Stärke wie „Fahrzeuge“ des
 * Servers (LLH-1095 D2: ein Fahrzeug zählt dort, wo seine Einheit steht).
 */

/** Was die Stärke im Raum von einer Einheit braucht. */
export interface RaumEinheit {
  id: number;
  ueber_einheit_id?: number | null;
  /** Eigene Ist-Stärke der Einheit, ohne ihre Untereinheiten. */
  ist: Staerke;
  /** Gesetzt, wenn die Einheit aufgelöst ist (LLH-1079); sie trägt nichts bei. */
  aufgeloest_at?: string | null;
}

export interface StaerkeImRaum {
  /** Summe der Einheiten im Raum; `null` bei leerem oder unvollständigem Raum. */
  staerke: Staerke | null;
  /**
   * Eine Einheit des Raums fehlt in der Einheitenliste (oder die Liste fehlt ganz): eine Summe
   * darüber wäre zu klein, sähe aber vollständig aus. Anzeige „—“ mit Grund.
   */
  unvollstaendig: boolean;
}

const NULL_STAERKE: Staerke = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 };

/** Fehlt `ist` (etwa in einem älteren eingefrorenen Stand), zählt die Einheit mit 0. */
function plus(a: Staerke, b: Staerke | undefined): Staerke {
  return {
    fuehrer: a.fuehrer + (b?.fuehrer ?? 0),
    unterfuehrer: a.unterfuehrer + (b?.unterfuehrer ?? 0),
    mannschaft: a.mannschaft + (b?.mannschaft ?? 0),
  };
}

/**
 * Stärke der Einheiten `einheitIds` (alle Einheiten im Raum) aus der Einheitenliste des
 * Einsatzes: die Summe ihrer eigenen Ist-Stärken. Jede Person gehört genau einer Einheit und
 * zählt damit genau einmal, auch wenn Ober- und Untereinheit beide im Raum stehen. Ein bloßes
 * `null` reichte nicht: „leer“ und „unvollständig“ sähen gleich aus.
 */
export function staerkeImRaum(
  einheitIds: readonly number[],
  alleEinheiten: readonly RaumEinheit[] | undefined,
): StaerkeImRaum {
  if (einheitIds.length === 0) return { staerke: null, unvollstaendig: false };
  if (alleEinheiten == null) return { staerke: null, unvollstaendig: true };
  const von = new Map(alleEinheiten.map((e) => [e.id, e]));
  const menge = [...new Set(einheitIds)].map((id) => von.get(id));
  if (menge.some((e) => e == null)) return { staerke: null, unvollstaendig: true };
  const aktiv = (menge as RaumEinheit[]).filter((e) => !e.aufgeloest_at);
  if (aktiv.length === 0) return { staerke: null, unvollstaendig: false };
  return { staerke: aktiv.reduce((s, e) => plus(s, e.ist), NULL_STAERKE), unvollstaendig: false };
}

/**
 * Stärke einer Einheit im Raum für ihre Zeile: ihre eigene Ist-Stärke samt der Untereinheiten
 * (auch Enkel über ein abwesendes Zwischenglied), die im selben Raum stehen. Eine Untereinheit
 * anderswo zählt nicht. `null`, wenn die Einheit in der Liste fehlt. Steht eine Untereinheit mit
 * im Raum, trägt sie ihre Zeile zusätzlich; die Summe des Raums bleibt `staerkeImRaum`.
 */
export function staerkeDerEinheitImRaum(
  einheitId: number,
  einheitIds: readonly number[],
  alleEinheiten: readonly RaumEinheit[] | undefined,
): Staerke | null {
  if (alleEinheiten == null) return null;
  const von = new Map(alleEinheiten.map((e) => [e.id, e]));
  const selbst = von.get(einheitId);
  if (!selbst) return null;
  const imRaum = new Set(einheitIds);
  imRaum.add(einheitId);
  /** Liegt `einheitId` auf dem Weg von `id` nach oben? Zyklussicher. */
  const unterstellt = (id: number): boolean => {
    const gesehen = new Set<number>([id]);
    let p = von.get(id)?.ueber_einheit_id ?? null;
    while (p != null && !gesehen.has(p)) {
      if (p === einheitId) return true;
      gesehen.add(p);
      p = von.get(p)?.ueber_einheit_id ?? null;
    }
    return false;
  };
  let summe = selbst.aufgeloest_at ? NULL_STAERKE : plus(NULL_STAERKE, selbst.ist);
  for (const id of imRaum) {
    if (id === einheitId) continue;
    const e = von.get(id);
    if (e && !e.aufgeloest_at && unterstellt(id)) summe = plus(summe, e.ist);
  }
  return summe;
}
