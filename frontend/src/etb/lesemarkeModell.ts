import type { EtbLesemarke } from '../api/types';
import { inZone, type AnzeigeKonventionen } from '../anzeige/format';
import { zeitKurz } from '../anzeige/zeitDarstellung';

/**
 * Wortlaut des Lesemarken-Banners (LFH-611, Neuentwurf S4) — oder `null`, wenn es nichts
 * zu melden gibt.
 *
 * Geschwiegen wird, wenn keine fremden Einträge über der Marke liegen und wenn das
 * Tagebuch leer ist (`hoechste_lfd_nr` fehlt): ohne sie hätte „alle als gesichtet
 * markieren" keinen Stand, den es zurückschicken könnte.
 *
 * Ohne Marke nennt der Satz KEINE Sichtung — die Person hat das Tagebuch nie als gesichtet
 * markiert, und „seit Ihrer letzten Sichtung" behauptete einen Zeitpunkt, den es nicht gibt.
 *
 * Die Zeit ist die Rolle „kurz“ des Formatkerns (LLH-1061): heute „um 1304“, sonst mit Tag
 * („212230“ bzw. „21.09. 22:30“); „heute" bestimmt `zeitKurz` in derselben Zone wie die Uhrzeit.
 */
export function lesemarkeText(marke: EtbLesemarke, konv: AnzeigeKonventionen): string | null {
  const n = marke.neue_anzahl;
  if (n <= 0 || marke.hoechste_lfd_nr == null) return null;

  if (!marke.gesichtet_at) {
    return n === 1
      ? '1 Eintrag, den Sie noch nicht gesichtet haben'
      : `${n} Einträge, die Sie noch nicht gesichtet haben`;
  }

  const menge = n === 1 ? '1 neuer Eintrag' : `${n} neue Einträge`;
  const d = inZone(marke.gesichtet_at, konv);
  const heute = inZone(new Date().toISOString(), konv);
  const kurz = zeitKurz(marke.gesichtet_at, konv);
  const wann = d.isSame(heute, 'day') ? `um ${kurz}` : kurz;
  return `${menge} seit Ihrer letzten Sichtung ${wann}`;
}

/**
 * Wortlaut der Trennlinie in der Zeitachse (LLH-1149, Spec `etb-zeitachse-darstellung`,
 * „Lesemarke als Trennlinie“): „Neu seit 1304 · 14 Einträge“ — taktisch, mit Tag, wenn die
 * Sichtung nicht von heute ist (`zeitKurz`, „211304“). `null` wie {@link lesemarkeText},
 * und auch ohne Marke: ohne gesichteten Eintrag gibt es keinen Ort für die Linie.
 */
export function lesemarkeLinie(marke: EtbLesemarke, konv: AnzeigeKonventionen): string | null {
  if (lesemarkeText(marke, konv) == null || marke.gesichtet_lfd_nr == null) return null;
  const n = marke.neue_anzahl;
  const seit = marke.gesichtet_at
    ? zeitKurz(marke.gesichtet_at, konv)
    : `Nr. ${marke.gesichtet_lfd_nr}`;
  return `Neu seit ${seit} · ${n === 1 ? '1 Eintrag' : `${n} Einträge`}`;
}

/**
 * Steht die Linie in der Achse (statt des Banners)? Nur ohne Filter — unter einem Filter fehlen
 * die meisten Einträge zwischen Marke und Ende, die Linie stünde an einer falschen Stelle — und
 * nur, wenn der zuletzt gesichtete Eintrag geladen ist und ein neuerer dahinter.
 */
export function lesemarkeImFenster(
  marke: EtbLesemarke | undefined,
  geladeneNummern: readonly number[],
  filterAktiv: boolean,
): boolean {
  const nr = marke?.gesichtet_lfd_nr;
  if (filterAktiv || nr == null || (marke?.neue_anzahl ?? 0) <= 0) return false;
  return geladeneNummern.includes(nr) && geladeneNummern.some((n) => n > nr);
}
