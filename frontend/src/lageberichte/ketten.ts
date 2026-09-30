/** Was eine Kette braucht: Kennung und Vorgänger. Lagebericht, Befehl und Pressemitteilung
 *  (LFH-554) teilen dieselbe Fortschreibung. */
interface Glied {
  id: number;
  vorgaenger_id?: number | null;
}

/** Ein Fortschreibungsstrang: der jüngste Stand als Kopf, die Vorgänger jüngster zuerst. */
export interface KettenKopf<T extends Glied> {
  kopf: T;
  vorgaenger: T[];
}

/**
 * Folgt `vorgaenger_id` ab `kopf` abwärts. Ein Vorgänger, der nicht in der Liste liegt
 * (gelöscht, anderer Einsatz, Datenfehler), beendet die Kette still; ein Zyklus ebenfalls —
 * `gesehen` ist der Abbruch, nicht eine Meldung.
 */
function folgeKette<T extends Glied>(kopf: T, nachId: ReadonlyMap<number, T>): KettenKopf<T> {
  const vorgaenger: T[] = [];
  const gesehen = new Set<number>([kopf.id]);
  let v = kopf.vorgaenger_id == null ? undefined : nachId.get(kopf.vorgaenger_id);
  while (v && !gesehen.has(v.id)) {
    vorgaenger.push(v);
    gesehen.add(v.id);
    v = v.vorgaenger_id == null ? undefined : nachId.get(v.vorgaenger_id);
  }
  return { kopf, vorgaenger };
}

/**
 * Bildet aus der flachen Berichtsliste die Fortschreibungsketten. Kopf ist jeder Bericht, auf
 * den KEIN anderer als Vorgänger zeigt — nicht „der mit `vorgaenger_id == null`", das ist das
 * ÄLTESTE Glied.
 *
 * Kein Bericht fällt aus der Sicht: bei einem vollständigen Zyklus (Datenfehler) gibt es keinen
 * Kopf; was nach dem ersten Durchgang in keiner Kette liegt, wird hinten mit gefolgter Kette
 * angehängt, damit die Verwandtschaft sichtbar bleibt. Die Reihenfolge der echten Köpfe bleibt.
 * Ein Vorgänger, auf den zwei Berichte zeigen, erscheint in beiden Ketten.
 */
export function kettenKoepfe<T extends Glied>(berichte: readonly T[]): KettenKopf<T>[] {
  const nachId = new Map(berichte.map((b) => [b.id, b]));
  const hatNachfolger = new Set(
    berichte.map((b) => b.vorgaenger_id).filter((id): id is number => id != null),
  );
  const ketten = berichte
    .filter((b) => !hatNachfolger.has(b.id))
    .map((kopf) => folgeKette(kopf, nachId));

  const gezeigt = new Set(ketten.flatMap((k) => [k.kopf.id, ...k.vorgaenger.map((v) => v.id)]));
  for (const b of berichte) {
    if (gezeigt.has(b.id)) continue;
    const kette = folgeKette(b, nachId);
    ketten.push(kette);
    gezeigt.add(kette.kopf.id);
    for (const v of kette.vorgaenger) gezeigt.add(v.id);
  }
  return ketten;
}
