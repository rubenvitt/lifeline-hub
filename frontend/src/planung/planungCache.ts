import type { QueryClient } from '@tanstack/react-query';
import { globalKeys } from '../api/queryKeys';
import type { Planung } from '../api/types';

/**
 * Übernimmt die Planung aus einer Schreibantwort (LLH-1586) und lädt sie gleich danach neu.
 *
 * Die Antwort zeigt sofort, was man selbst geändert hat. Kommt sie aber spät, kann ein schon
 * abgeschlossener Live-Abruf (Änderung eines anderen) neuer sein; `kopf.version` ordnet nur den
 * Kopf, nicht Posten, Blöcke und Helfer. Der Abruf startet erst nach dem Einsetzen der Antwort und
 * bringt damit den letzten Stand, ein noch laufender älterer wird abgebrochen.
 */
export function uebernimmPlanung(qc: QueryClient, p: Planung): void {
  qc.setQueryData(globalKeys.planung(p.kopf.id), p);
  void qc.invalidateQueries({ queryKey: globalKeys.planung(p.kopf.id), exact: true });
}
