import type { EtbFilterWerte } from '../api/etb';
import type { EtbTyp } from '../api/types';
import { inZone, type AnzeigeKonventionen } from '../anzeige/format';
import { alsOrtszeit } from './filterZeit';

export interface AuswahlOptionen {
  /** Anzeigezone der Organisation bzw. des Einsatzes (`useAnzeigeKonventionen`). */
  konventionen: AnzeigeKonventionen;
  /** Typwort zu einem ETB-Typ („Meldung"), aus dem Statusvertrag. */
  typWort: (typ: EtbTyp) => string;
  /** Name einer Einheit, falls lesbar; `undefined` = Modul gesperrt oder unbekannt. */
  einheitName: (id: number) => string | undefined;
}

/** Wire-Zeit (UTC ohne Zonenkennung) → „21.09.2026 08:00" in der Anzeigezone. */
function zeit(wire: string, konventionen: AnzeigeKonventionen): string | null {
  // `alsOrtszeit` verwirft Unbrauchbares GANZ; ein rohes `dayjs(s)` läse den Wire-String als
  // Ortszeit und verschöbe den Zeitraum still um den Versatz.
  if (!alsOrtszeit(wire)) return null;
  return inZone(wire, konventionen).format('DD.MM.YYYY HH:mm');
}

/**
 * Die gedruckte Auswahl in Worten für den Druckkopf der ETB-Druckansicht (LFH-22,
 * design.md D6). Feste Folge: Typ, Zeitraum, Suchbegriff, Einheit. Ohne Filter heißt es
 * „vollständiges Tagebuch" — ein Ausdruck muss sagen, OB er eine Auswahl ist.
 *
 * Eine Datenbank-Kennung erscheint nie: eine Einheit ohne lesbaren Namen heißt „eine
 * Einheit (Name nicht verfügbar)". Auf Papier ist eine Kennung nicht nachschlagbar und
 * behauptete eine Zuordnung, die niemand prüfen kann.
 */
export function auswahlZeilen(
  filter: Pick<EtbFilterWerte, 'q' | 'typ' | 'von' | 'bis' | 'einheit_id'>,
  { konventionen, typWort, einheitName }: AuswahlOptionen,
): string[] {
  const zeilen: string[] = [];
  if (filter.typ) zeilen.push(`Typ: ${typWort(filter.typ)}`);
  const von = filter.von ? zeit(filter.von, konventionen) : null;
  const bis = filter.bis ? zeit(filter.bis, konventionen) : null;
  if (von && bis) zeilen.push(`Zeitraum: ${von} bis ${bis}`);
  else if (von) zeilen.push(`Zeitraum: ab ${von}`);
  else if (bis) zeilen.push(`Zeitraum: bis ${bis}`);
  if (filter.q) zeilen.push(`Suchbegriff: „${filter.q}“`);
  if (filter.einheit_id != null) {
    const name = einheitName(filter.einheit_id);
    zeilen.push(name ? `betrifft ${name}` : 'betrifft eine Einheit (Name nicht verfügbar)');
  }
  return zeilen.length > 0 ? zeilen : ['vollständiges Tagebuch'];
}
