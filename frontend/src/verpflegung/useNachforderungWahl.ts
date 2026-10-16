/**
 * Nachforderungen als Verweis einer Ausgabe (LFH-634 D4/D9), geteilt von Modulseite und
 * Ausgabeansicht (LLH-1032, D8).
 *
 * Nur bei bedienbarem Modul — und erst, wenn die Freigaben bekannt sind (`istKeyFreigegeben`
 * gibt bei unbekannten Freigaben nichts frei). Ein 403 bleibt still: dann gibt es keine Optionen
 * und am Verweis nur „Nachforderung #n“.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { listeNachforderungen } from '../api/nachforderungen';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import type { NachforderungOption } from './VerpflegungDialoge';

export interface NachforderungWahl {
  /** Modul Nachforderungen für die Person bedienbar. */
  frei: boolean;
  /** Name je Nachforderung, für den Verweis an einer Ausgabe. */
  namen: ReadonlyMap<number, string>;
  /** Auswahl im Formular; `null` ohne freies Modul (dann kein Feld). */
  optionen: NachforderungOption[] | null;
}

export function useNachforderungWahl(
  einsatzId: number,
  freigaben: ModulFreigaben | undefined,
): NachforderungWahl {
  const frei = istKeyFreigegeben('nachforderungen', freigaben);
  const query = useQuery({
    // Derselbe Schlüssel und dieselbe Abfrage wie `NachforderungenPage` — ein Cache-Fach, eine Form.
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
    enabled: frei,
    retry: false,
  });
  const liste = useMemo(
    () => (frei && !query.isError ? (query.data ?? []) : []),
    [frei, query.isError, query.data],
  );
  const namen = useMemo(() => new Map(liste.map((n) => [n.id, n.bezeichnung])), [liste]);
  const optionen = useMemo(
    () => (frei ? liste.map((n) => ({ value: n.id, label: n.bezeichnung })) : null),
    [frei, liste],
  );
  return { frei, namen, optionen };
}
