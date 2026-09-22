import dayjs from 'dayjs';
import type { EtbLesemarke } from '../api/types';
import { inZone, type AnzeigeKonventionen } from '../anzeige/format';

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
 * Der Tag steht nur dabei, wenn die Sichtung nicht von heute ist; „heute" wird in DERSELBEN
 * Zone bestimmt wie die Uhrzeit (Muster `formatUhrzeitMitTag`), sonst kippt die Tagesgrenze.
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
  const jetzt = konv.zeitzone ? dayjs().tz(konv.zeitzone) : dayjs();
  const wann = d.isSame(jetzt, 'day')
    ? `um ${d.format('HH:mm')}`
    : `am ${d.format('DD.MM.')} um ${d.format('HH:mm')}`;
  return `${menge} seit Ihrer letzten Sichtung ${wann}`;
}
