import type { Staerke } from '../api/types';
import { summiereStaerke, type StaerkeTraeger } from '../anzeige/staerke';

/**
 * Zahlen eines Bereitstellungsraums, die im Client entstehen (LLH-1095 D1, Spec
 * `bereitstellungsraum-belegung`). Seitenfrei, weil Liste, Detailseite und die Lagekarte
 * (LLH-1107) dieselbe Rechnung brauchen. Fahrzeuge, Einheiten und längste Wartezeit rechnet der
 * Server (`belegung`), nur die Stärke bleibt hier über `summiereStaerke` (`frontend/AGENTS.md`,
 * „Eine Heimat je Zahl“).
 */

export interface StaerkeImRaum {
  /** Summe der Einheiten im Raum; `null` bei leerem oder unvollständigem Raum. */
  staerke: Staerke | null;
  /**
   * Eine Einheit des Raums fehlt in der Einheitenliste (oder die Liste fehlt ganz): eine Summe
   * darüber wäre zu klein, sähe aber vollständig aus. Anzeige „—“ mit Grund.
   */
  unvollstaendig: boolean;
}

/**
 * Stärke der Einheiten `einheitIds` aus der Einheitenliste des Einsatzes. Ein bloßes `null`
 * reichte nicht: `summiereStaerke` liefert es auch für die leere Menge, „leer“ und
 * „unvollständig“ sähen gleich aus. Die ganze Liste trägt die Unterstellung auch über Einheiten
 * außerhalb des Raums (LFH-550): eine Enkeleinheit zählt nicht doppelt, wenn nur ihr Großvater
 * hier steht.
 */
export function staerkeImRaum(
  einheitIds: readonly number[],
  alleEinheiten: readonly StaerkeTraeger[] | undefined,
): StaerkeImRaum {
  if (einheitIds.length === 0) return { staerke: null, unvollstaendig: false };
  if (alleEinheiten == null) return { staerke: null, unvollstaendig: true };
  const von = new Map(alleEinheiten.map((e) => [e.id, e]));
  const menge = einheitIds.map((id) => von.get(id));
  if (menge.some((e) => e == null)) return { staerke: null, unvollstaendig: true };
  return {
    staerke: summiereStaerke(menge as StaerkeTraeger[], alleEinheiten),
    unvollstaendig: false,
  };
}
