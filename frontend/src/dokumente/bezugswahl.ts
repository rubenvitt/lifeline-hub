import { useState } from 'react';
import { listeEtb } from '../api/etb';
import type { EtbEintragAnzeige } from '../api/types';

/** So viele ETB-Einträge stehen ohne Suchbegriff als Bezug zur Wahl (die jüngsten). Was älter
 *  ist, findet die Suche am Server (LFH-655). */
export const ETB_BEZUG_DECKEL = 100;

/**
 * Lädt die ETB-Einträge, die die Bezugswahl für einen Suchbegriff anbietet (LFH-655).
 *
 * - Ohne Begriff: die jüngsten {@link ETB_BEZUG_DECKEL} Einträge.
 * - Mit Begriff: die Volltextsuche des Servers (`q`), ebenfalls gedeckelt — sie reicht über
 *   den ganzen Einsatz, nicht nur über das jüngste Fenster.
 * - Ist der Begriff eine laufende Nummer („412“ oder „ETB 412“, so wie die Option sie zeigt),
 *   steht der Eintrag mit genau dieser Nummer vorn. Ihn holt der Cursor (`before_lfd_nr` =
 *   n + 1, `limit` 1) wie den Zahlenzweig der Sprungpalette (`etbNummerSchluessel` in
 *   `command-palette/datensatzAbfrage.ts`); ob die Antwort die gesuchte Nummer trägt, prüft
 *   auch hier der Aufrufer.
 */
export async function ladeEtbBezuege(
  einsatzId: number,
  suche: string,
): Promise<EtbEintragAnzeige[]> {
  // Das Präfix „ETB“ trägt jede Option, im Volltext steht es nicht.
  const begriff = suche.replace(/^etb(?=\s|\d|$)\s*/i, '').trim();
  if (!begriff) return listeEtb(einsatzId, { limit: ETB_BEZUG_DECKEL });

  const nummer = /^\d+$/.test(begriff) ? Number(begriff) : null;
  const [volltext, perNummer] = await Promise.all([
    listeEtb(einsatzId, { q: begriff, limit: ETB_BEZUG_DECKEL }),
    nummer != null && nummer > 0
      ? listeEtb(einsatzId, { before_lfd_nr: nummer + 1, limit: 1 })
      : Promise.resolve([]),
  ]);
  const genau = perNummer.filter((e) => e.lfd_nr === nummer);
  return [...genau, ...volltext.filter((e) => !genau.some((g) => g.id === e.id))];
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
