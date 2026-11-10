/**
 * Antrag am Spiegel (LLH-1492, Spec `spiegel-antraege`, design.md D9): eine beantragbare Erfassung
 * an einem Einsatz, den eine andere Instanz führt, beantwortet der Server mit 202 und
 * `{ antrag: { id, zustand } }` statt der Ressource. Ohne Importe, damit `api/client.ts` es
 * ohne Ringbezug nutzen kann.
 */

/**
 * Körper der 202-Antwort. Handgeschrieben: der Server baut ihn ohne Schema (`antrag_antwort` in
 * `src/instanz/spiegel/antrag.rs`).
 */
export interface AntragAngenommen {
  antrag: { id: number; zustand: string };
}

/** Ob eine Antwort ein angenommener Antrag ist statt der Ressource. Keine Ressource der
 *  beantragbaren Routen trägt ein Objekt `antrag` mit Kennung und Zustand. */
export function isAntragAngenommen(antwort: unknown): antwort is AntragAngenommen {
  if (antwort == null || typeof antwort !== 'object' || !('antrag' in antwort)) return false;
  const antrag = (antwort as { antrag: unknown }).antrag;
  return (
    antrag != null &&
    typeof antrag === 'object' &&
    typeof (antrag as { id?: unknown }).id === 'number' &&
    typeof (antrag as { zustand?: unknown }).zustand === 'string'
  );
}

/**
 * Fenster-Ereignis nach jedem angenommenen Antrag, mit der Einsatz-Kennung im `detail`. Darauf
 * gleichen Antragsliste und Einsatzkopf (Zähler im Hinweisband) ab — auch nach dem Senden der
 * Warteschlange, die am Spiegel ebenfalls Anträge erzeugt.
 */
export const ANTRAG_EREIGNIS = 'lfh:spiegel-antrag';

/** Einsatz-Kennung aus einem Pfad `/api/einsaetze/{id}/…`. */
function parseEinsatzAusPfad(pfad: string): number | null {
  const treffer = /^\/api\/einsaetze\/(\d+)\//.exec(pfad);
  return treffer ? Number(treffer[1]) : null;
}

/** Meldet einen angenommenen Antrag, falls die 202-Antwort einer ist (`apiSend`). */
export function dispatchAntragIfAngenommen(pfad: string, antwort: unknown): void {
  if (!isAntragAngenommen(antwort)) return;
  const einsatzId = parseEinsatzAusPfad(pfad);
  if (einsatzId == null || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ANTRAG_EREIGNIS, { detail: { einsatzId } }));
}
