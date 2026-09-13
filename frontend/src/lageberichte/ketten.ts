import type { LageberichtAnzeige } from '../api/types';

/** Ein Fortschreibungsstrang: der jüngste Stand als Kopf, die Vorgänger jüngster zuerst. */
export interface KettenKopf {
  kopf: LageberichtAnzeige;
  vorgaenger: LageberichtAnzeige[];
}

/**
 * Folgt `vorgaenger_id` ab `kopf` abwärts. Ein Vorgänger, der nicht in der Liste liegt
 * (gelöscht, anderer Einsatz, Datenfehler), beendet die Kette still; ein Zyklus ebenfalls —
 * `gesehen` ist der Abbruch, nicht eine Meldung.
 */
function folgeKette(
  kopf: LageberichtAnzeige,
  nachId: ReadonlyMap<number, LageberichtAnzeige>,
): KettenKopf {
  const vorgaenger: LageberichtAnzeige[] = [];
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
 * Bildet aus der flachen Berichtsliste die Fortschreibungsketten (LFH-348 · C13, Befund N23).
 *
 * `vorgaenger_id` lag seit LFH-330 unbenutzt auf dem Wire: die Liste zeigte v1 und v2
 * desselben Berichts als zwei gleichnamige Karten, unterscheidbar nur an der Fassung. Kopf
 * einer Kette ist jeder Bericht, auf den KEIN anderer als Vorgänger zeigt — nicht „der mit
 * `vorgaenger_id == null`", der ist das ÄLTESTE Glied.
 *
 * KEIN BERICHT FÄLLT AUS DER SICHT (LFH-495, Nachzug zu C13). Bei einem VOLLSTÄNDIGEN Zyklus
 * (`11 → 13 → 11`, ein Datenfehler) hat jedes Glied einen Nachfolger, es gibt also keinen
 * Kopf — die Funktion lieferte dafür eine LEERE Liste, und die Berichte verschwanden
 * lautlos aus der Übersicht. Ein Datenfehler in einer Führungsunterlage darf die Unterlage
 * nicht unsichtbar machen: was nach dem ersten Durchgang in keiner Kette liegt, wird
 * hinten als eigene Kette angehängt.
 *
 * ANGEHÄNGT WIRD MIT GEFOLGTER KETTE, nicht als nackter Einzelkopf (das Ticket schlug
 * Einzelköpfe vor): `folgeKette` bricht den Zyklus ohnehin ab, das erste Glied trägt die
 * übrigen damit als Vorgänger und die Verwandtschaft bleibt sichtbar, statt als n
 * gleichnamige Karten nebeneinander zu stehen — genau das Bild, gegen das N23 gebaut wurde.
 *
 * DIE LISTENREIHENFOLGE DER ECHTEN KÖPFE BLEIBT: die Restmenge kommt NACH ihnen, nie
 * dazwischen. Die Serverordnung ist Sache der Sicht, und ein Datenfehler soll sie nicht
 * umsortieren. Gezählt wird beim Anhängen der KOPF-Kandidat; ein Vorgänger, auf den zwei
 * Berichte zeigen (ebenfalls ein Datenfehler), erscheint in beiden Ketten — unverändert
 * gegenüber dem Bestand, in dem jeder Kopf seine Vorgänger unabhängig abläuft.
 */
export function kettenKoepfe(berichte: readonly LageberichtAnzeige[]): KettenKopf[] {
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
