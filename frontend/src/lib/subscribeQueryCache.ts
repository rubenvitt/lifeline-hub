import { notifyManager, type QueryClient } from '@tanstack/react-query';

/**
 * Abo auf den ganzen Abfragecache für `useSyncExternalStore`, gebündelt nachgereicht.
 *
 * Der Cache meldet SYNCHRON, auch während eine andere Komponente rendert und dabei per `useQuery`
 * eine Abfrage anlegt. Ein roh abonnierter Leser würde dann mitten in fremdem Rendern
 * aktualisiert; React warnt „Cannot update a component … while rendering a different component“
 * (LLH-1904: die Betriebszeile beim Abmelden, während die Sprungpalette ihren Key wechselt).
 * `batchCalls` reicht die Meldung nach wie TanStacks eigene Zähler (`useIsFetching`), danach liest
 * `useSyncExternalStore` den Stand neu.
 *
 * Ohne `QueryClientProvider` (`client` fehlt) ein Abo, das nie meldet.
 */
export function subscribeQueryCache(
  client: QueryClient | null | undefined,
  notify: () => void,
): () => void {
  if (!client) return () => {};
  return client.getQueryCache().subscribe(notifyManager.batchCalls(notify));
}
