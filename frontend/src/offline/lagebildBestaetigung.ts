import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Meldet jeden Fetch-Erfolg im Cache (LFH-723, design.md D4) — die Server-Antworten, an denen
 * die Höchstliegezeit und das Lösen einer Sperrmarke hängen.
 *
 * Unterscheidungsmerkmal ist `action.manual`: `setQueryData` setzt es (query-core
 * `Query.setData`), ein Abruf nicht, und `hydrate` erzeugt gar keine `success`-Aktion,
 * sondern ein `setState`. Ein wiederhergestellter Stand bestätigt also nichts, und ein
 * künftiges optimistisches Update verlängert die Frist nicht.
 */
export function fetchErfolgeVerfolgen(
  qc: QueryClient,
  beiErfolg: (key: QueryKey) => void,
): () => void {
  return qc.getQueryCache().subscribe((ereignis) => {
    if (
      ereignis.type === 'updated' &&
      ereignis.action.type === 'success' &&
      ereignis.action.manual !== true
    ) {
      beiErfolg(ereignis.query.queryKey);
    }
  });
}
