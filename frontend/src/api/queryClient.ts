import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { ApiError, NetzFehler } from './client';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';

/** Produktionsdefaults an einem importierbaren Seam statt versteckt in `main.tsx`.
 *  Nur reine Query-Pfade dürfen einen Leitungsfehler zweimal wiederholen; fachliche
 *  Serverantworten und sämtliche Mutationen werden nie automatisch erneut gesendet. */
export const queryClientDefaults = {
  queries: {
    retry: (fehlversuche: number, fehler: unknown) =>
      fehler instanceof NetzFehler && fehlversuche < 2,
    retryDelay: (fehlversuche: number) => Math.min(1_000 * 2 ** fehlversuche, 30_000),
    staleTime: 10_000,
  },
  mutations: { retry: 0 },
} satisfies DefaultOptions;

/** Globaler Fehler-Seam für Queries UND Mutationen.
 *
 *  Behandelt bewusst **nur 401**. In react-query v5 feuert `MutationCache.onError` ZUSÄTZLICH
 *  zum mutationseigenen `onError`, und `QueryCache.onError` bei jedem Query-Fehler inklusive
 *  stiller Hintergrund-Refetches; ein generischer Toast stünde neben jeder lokalen
 *  Fehlermeldung.
 *
 *  Ein `ApiError` ≠ 401 ist eine fachliche Ablehnung, die der lokale Handler mit Kontext meldet;
 *  ein `NetzFehler` ist ein erwarteter Betriebszustand. Nur sonstige Fehler (etwa
 *  Programmierfehler) werden protokolliert. */
function behandleFehler(fehler: unknown): void {
  if (fehler instanceof ApiError) {
    if (fehler.status === 401) meldeSitzungAbgelaufen();
    return;
  }
  if (fehler instanceof NetzFehler) return;
  console.error('Unerwarteter Fehler in einer Query/Mutation', fehler);
}

/** Einziger Bauplan für den QueryClient, von `main.tsx` UND `test/utils.tsx` genutzt, damit der
 *  globale Handler auch in Tests wirkt. */
export function erzeugeQueryClient(
  defaultOptions: DefaultOptions = queryClientDefaults,
): QueryClient {
  return new QueryClient({
    defaultOptions,
    queryCache: new QueryCache({ onError: behandleFehler }),
    mutationCache: new MutationCache({ onError: behandleFehler }),
  });
}
