import { useState } from 'react';
import { listeEtb } from '../api/etb';
import type { EtbEintragAnzeige } from '../api/types';

/** So viele ETB-Einträge stehen ohne Suchbegriff als Bezug zur Wahl (die jüngsten). Was älter
 *  ist, findet die Suche am Server (LFH-655). */
export const ETB_BEZUG_DECKEL = 100;

/** Server-Treffer zu genau einem Suchbegriff; `eintraege` ist `null`, wenn die Suche scheiterte. */
export interface EtbSuchTreffer {
  begriff: string;
  eintraege: EtbEintragAnzeige[] | null;
}

/** Das Präfix „ETB“ trägt jede Option, im Volltext steht es nicht. */
const ohnePraefix = (suche: string) => suche.replace(/^etb(?=\s|\d|$)\s*/i, '').trim();

/** Die laufende Nummer, wenn der Begriff eine ist („412“ oder „ETB 412“), sonst `null`. */
function etbNummer(suche: string): number | null {
  const rest = ohnePraefix(suche);
  if (!/^\d+$/.test(rest)) return null;
  const nummer = Number(rest);
  // Über `Number.MAX_SAFE_INTEGER` liefe `nummer + 1` aus dem i64 des Servers und risse die
  // ganze Suche in den Fehlerzweig.
  return Number.isSafeInteger(nummer) && nummer > 0 ? nummer : null;
}

/**
 * Sucht ETB-Einträge für die Bezugswahl am Server (LFH-655), über den ganzen Einsatz:
 *
 * - die Volltextsuche (`q`, gedeckelt). Sie trifft Wortanfänge, aber keine Wortmitten
 *   (`fts_query` in `src/etb/repo.rs`, LFH-880); Wortmitten und Teilnummern deckt
 *   {@link waehleEtbEintraege} über das jüngste Fenster ab.
 * - bei einer laufenden Nummer den Eintrag mit genau dieser Nummer. Ihn holt der Cursor
 *   (`before_lfd_nr` = n + 1, `limit` 1) wie den Zahlenzweig der Sprungpalette
 *   (`etbNummerSchluessel` in `command-palette/datensatzAbfrage.ts`); ob die Antwort die gesuchte
 *   Nummer trägt, prüft auch hier der Aufrufer.
 */
export async function sucheEtbBezuege(
  einsatzId: number,
  suche: string,
): Promise<EtbEintragAnzeige[]> {
  const begriff = ohnePraefix(suche);
  const nummer = etbNummer(suche);
  const [volltext, perNummer] = await Promise.all([
    begriff ? listeEtb(einsatzId, { q: begriff, limit: ETB_BEZUG_DECKEL }) : Promise.resolve([]),
    nummer != null
      ? listeEtb(einsatzId, { before_lfd_nr: nummer + 1, limit: 1 })
      : Promise.resolve([]),
  ]);
  return [...perNummer.filter((e) => e.lfd_nr === nummer), ...volltext];
}

/**
 * Die ETB-Einträge, die die Bezugswahl zu einem getippten Begriff anbietet.
 *
 * Das jüngste Fenster filtert immer der Client am sichtbaren Text („ETB 412 · …“): so treffen
 * Wortmitten und Teilnummern, die der Server nicht findet, und solange die Server-Antwort für GENAU diesen Begriff fehlt
 * (entprellt, unterwegs, gescheitert), steht nie ein Eintrag zur Wahl, der nicht passt — Enter
 * nähme sonst den ersten unpassenden. Gehören die Server-Treffer zum Begriff, kommen sie dazu:
 * der Eintrag mit genau der getippten Nummer vorn, sonst absteigend nach laufender Nummer.
 */
export function waehleEtbEintraege(
  fenster: EtbEintragAnzeige[],
  treffer: EtbSuchTreffer | null,
  suche: string,
): EtbEintragAnzeige[] {
  const begriff = suche.trim();
  if (!begriff) return fenster;
  const klein = begriff.toLowerCase();
  const lokal = fenster.filter((e) =>
    `etb ${e.lfd_nr} · ${e.inhalt}`.toLowerCase().includes(klein),
  );
  if (treffer?.begriff !== begriff || !treffer.eintraege) return lokal;

  const nummer = etbNummer(begriff);
  const alle = new Map<number, EtbEintragAnzeige>();
  for (const e of [...treffer.eintraege, ...lokal]) alle.set(e.id, e);
  return [...alle.values()].sort(
    (a, b) => Number(b.lfd_nr === nummer) - Number(a.lfd_nr === nummer) || b.lfd_nr - a.lfd_nr,
  );
}

/**
 * Hält einen Wert fest, solange eine Auswahlliste offen ist — „kein Sprung unter dem Cursor“
 * (WCAG 3.2.5, `frontend/AGENTS.md`, Layout und Live). Ein Live-Update, das bei offener Liste
 * eintrifft, schiebt nichts ein und verschiebt keine Gruppe; es erscheint beim nächsten Öffnen.
 *
 * `stand` benennt, WAS gerade geladen vorliegt (der Suchbegriff, zu dem die Daten gehören), und
 * ist `null`, solange noch geladen wird. Ein neuer Stand ist eine Handlung des Menschen (er hat
 * gesucht) und darf die Liste neu aufbauen; ein Nachladen desselben Standes nicht. Bevor der
 * erste Stand da ist, zeigt die Liste den Ladezustand wie bisher.
 */
export function useStandWaehrendOffen<T>(live: T, offen: boolean, stand: string | null): T {
  const [bild, setBild] = useState<{ stand: string | null; wert: T } | null>(null);
  if (!offen) {
    if (bild !== null) setBild(null);
    return live;
  }
  if (bild === null || (stand !== null && stand !== bild.stand)) {
    setBild({ stand, wert: live });
    return live;
  }
  // Ein Bild aus der Ladephase ist noch kein Stand: bis der erste ankommt, gilt der Live-Wert.
  return bild.stand === null ? live : bild.wert;
}
