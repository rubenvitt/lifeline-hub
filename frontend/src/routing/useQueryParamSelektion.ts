import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { parseRouteId } from './deeplinks';

/**
 * Konsumiert einen Query-Param-Deeplink (`?<key>=<id>`) auf einer Listenseite: parst die ID,
 * wendet sie — sobald `bereit` — EINMAL über `anwenden` an und räumt den Param danach
 * (apply-then-clean, `replace`). Ein stehender Param pinnte die Selektion und würde bei
 * Back/Reload erneut angewandt.
 * `anwenden` steht absichtlich nicht in den Effekt-Deps (meist eine Inline-Closure); getaktet
 * wird über `searchParams`/`bereit`. Existenzprüfungen gehören in die `anwenden`-Closure.
 */
export function useQueryParamSelektion(
  key: string,
  bereit: boolean,
  anwenden: (id: number) => void,
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (!searchParams.has(key)) return;
    if (!bereit) return;
    const id = parseRouteId(searchParams.get(key) ?? undefined);
    if (id != null) anwenden(id);
    // Klonen statt in-place mutieren: die Router-Instanz ist über Render/Effekt geteilt; ein
    // in-place `delete` ließe einen konkurrierenden Default-Effekt den Param geräumt sehen und das
    // Deeplink-Ziel wegdefaulten.
    const geraeumt = new URLSearchParams(searchParams);
    geraeumt.delete(key);
    setSearchParams(geraeumt, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams, key, bereit]);
}
