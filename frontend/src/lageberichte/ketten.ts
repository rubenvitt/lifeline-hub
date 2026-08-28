import type { LageberichtAnzeige } from '../api/types';

/** Ein Fortschreibungsstrang: der jüngste Stand als Kopf, die Vorgänger jüngster zuerst. */
export interface KettenKopf {
  kopf: LageberichtAnzeige;
  vorgaenger: LageberichtAnzeige[];
}

/**
 * Bildet aus der flachen Berichtsliste die Fortschreibungsketten (LFH-348 · C13, Befund N23).
 *
 * `vorgaenger_id` lag seit LFH-330 unbenutzt auf dem Wire: die Liste zeigte v1 und v2
 * desselben Berichts als zwei gleichnamige Karten, unterscheidbar nur an der Fassung. Kopf
 * einer Kette ist jeder Bericht, auf den KEIN anderer als Vorgänger zeigt — nicht „der mit
 * `vorgaenger_id == null`", der ist das ÄLTESTE Glied.
 *
 * Ein Vorgänger, der nicht in der Liste liegt (gelöscht, anderer Einsatz, Datenfehler),
 * beendet die Kette still; ein Zyklus (Datenfehler) ebenfalls — beides ist ein Fall, den
 * die Anzeige aushalten muss, nicht einer, den sie meldet.
 */
export function kettenKoepfe(berichte: readonly LageberichtAnzeige[]): KettenKopf[] {
  const nachId = new Map(berichte.map((b) => [b.id, b]));
  const hatNachfolger = new Set(
    berichte.map((b) => b.vorgaenger_id).filter((id): id is number => id != null),
  );
  return berichte
    .filter((b) => !hatNachfolger.has(b.id))
    .map((kopf) => {
      const vorgaenger: LageberichtAnzeige[] = [];
      const gesehen = new Set<number>([kopf.id]);
      let v = kopf.vorgaenger_id == null ? undefined : nachId.get(kopf.vorgaenger_id);
      while (v && !gesehen.has(v.id)) {
        vorgaenger.push(v);
        gesehen.add(v.id);
        v = v.vorgaenger_id == null ? undefined : nachId.get(v.vorgaenger_id);
      }
      return { kopf, vorgaenger };
    });
}
