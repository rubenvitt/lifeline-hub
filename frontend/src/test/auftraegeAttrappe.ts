import type { AbschlussCursor } from '../api/meldungen';
import type { Auftrag, AuftragKennzahlen } from '../api/types';
import { ApiError } from '../api/client';

/**
 * Attrappe der Lese-Funktionen aus `api/auftraege` für Seitentests (LFH-1071): Phase, Seiten,
 * Kennzahlen und Einzelabruf werden aus EINER Vollliste abgeleitet, so wie der Server sie aus
 * der Tabelle liest. Tests setzen weiter nur die Vollliste.
 */

type Filter = { richtung?: string; abschnittId?: number; einheitId?: number };
type Quelle = (einsatzId: number, filter: Filter) => Promise<Auftrag[]>;

const istAbgeschlossen = (a: Auftrag) =>
  a.bearbeitungsstatus === 'vollzogen' || a.bearbeitungsstatus === 'abgenommen';
const abschlussZeit = (a: Auftrag) => a.abgenommen_at ?? a.vollzogen_at ?? a.erstellt_at;

export const AUFTRAEGE_SEITE_ATTRAPPE = 100;

export function auftraegeLeseAttrappe(quelle: Quelle) {
  return {
    AUFTRAEGE_SEITE: AUFTRAEGE_SEITE_ATTRAPPE,
    listeAuftraege: quelle,
    auftragAbschlussCursor: (a: Auftrag): AbschlussCursor => ({ zeit: abschlussZeit(a), id: a.id }),
    listeOffeneAuftraege: async (einsatzId: number, filter: Filter = {}) =>
      (await quelle(einsatzId, filter)).filter((a) => !istAbgeschlossen(a)),
    listeAbgeschlosseneAuftraege: async (
      einsatzId: number,
      filter: Filter = {},
      vor?: AbschlussCursor,
      limit: number = AUFTRAEGE_SEITE_ATTRAPPE,
    ) =>
      (await quelle(einsatzId, filter))
        .filter(istAbgeschlossen)
        .sort((a, b) => abschlussZeit(b).localeCompare(abschlussZeit(a)) || b.id - a.id)
        .filter(
          (a) =>
            !vor || abschlussZeit(a) < vor.zeit || (abschlussZeit(a) === vor.zeit && a.id < vor.id),
        )
        .slice(0, limit),
    ladeAuftragKennzahlen: async (
      einsatzId: number,
      filter: Filter = {},
    ): Promise<AuftragKennzahlen> => {
      const alle = await quelle(einsatzId, filter);
      const abgeschlossen = alle.filter(istAbgeschlossen).length;
      return { offen: alle.length - abgeschlossen, abgeschlossen };
    },
    ladeAuftrag: async (einsatzId: number, auftragId: number) => {
      const treffer = (await quelle(einsatzId, {})).find((a) => a.id === auftragId);
      if (!treffer) throw new ApiError(404, 'Nicht gefunden');
      return treffer;
    },
  };
}
