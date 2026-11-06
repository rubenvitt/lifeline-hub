import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { parseRouteId } from './deeplinks';
import { useLinkAuftrag } from './useLinkAuftrag';

/**
 * Konsumiert einen Query-Param-Deeplink (`?<key>=<id>`) auf einer Listenseite: parst die ID,
 * wendet sie — sobald `bereit` — EINMAL über `anwenden` an und räumt den Param danach
 * (apply-then-clean, `replace`). Ein stehender Param pinnte die Selektion und würde bei
 * Back/Reload erneut angewandt.
 *
 * Einmal je Verlaufseintrag (`useLinkAuftrag`, LLH-1530): Bis der Router die Räumung committet,
 * zeigt `searchParams` noch den Param. Wechselt `bereit` in dieser Zeit (die Liste lädt neu, eine
 * angewandte Selektion wechselt die Abfrage), setzte der Effekt die Selektion sonst ein zweites
 * Mal, über eine Wahl der Person hinweg. Ein neuer Link derselben Art ist ein neuer Eintrag und
 * wirkt.
 *
 * `anwenden` steht absichtlich nicht in den Effekt-Deps (meist eine Inline-Closure); getaktet
 * wird über `searchParams`/`bereit`. Existenzprüfungen gehören in die `anwenden`-Closure.
 */
export function useQueryParamSelektion(
  key: string,
  bereit: boolean,
  anwenden: (id: number) => void,
): void {
  const [searchParams] = useSearchParams();
  const auftrag = useLinkAuftrag();
  useEffect(() => {
    if (!searchParams.has(key)) return;
    if (auftrag.verbraucht()) return;
    if (!bereit) return;
    const id = parseRouteId(searchParams.get(key) ?? undefined);
    if (id != null) anwenden(id);
    // Geklont statt in-place gelöscht (`useLinkAuftrag`): ein konkurrierender Default-Effekt sähe
    // den Param sonst geräumt und defaultete das Deeplink-Ziel weg.
    auftrag.raeume(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, auftrag, key, bereit]);
}
