import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseRouteId } from './deeplinks';

/**
 * Konsumiert einen Query-Param-Deeplink (`?<key>=<id>`) auf einer Listenseite (LFH-25):
 * parst die ID robust, wendet sie — sobald `bereit` (Daten geladen) — EINMAL über `anwenden`
 * an und räumt den Param danach aus der URL (apply-then-clean, `replace`).
 *
 * Das Aufräumen ist bewusst: ein dauerhaft in der URL stehender Selektions-Param würde die
 * Selektion „pinnen" (manuelles Abwählen ginge nicht) und Browser-Back/Reload würde ihn
 * erneut anwenden. `anwenden` ist absichtlich nicht in den Effekt-Deps — der Aufrufer gibt
 * i.d.R. eine Inline-Closure; die Ausführung wird über `searchParams`/`bereit` getaktet.
 * Existenz-/Sonderlogik (z. B. „nur selektieren, wenn die ID in der Liste vorkommt") gehört
 * in die `anwenden`-Closure.
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
    // searchParams NICHT in-place mutieren, sondern klonen: die vom Router gelieferte
    // Instanz ist über Render/Effekt hinweg geteilt — ein in-place delete ließe einen
    // konkurrierenden Default-Effekt den Param bereits geräumt sehen und das Deeplink-Ziel
    // wegdefaulten (Root-Cause aus LFH-150, Präzedenz-Fix in GefahrenPage.tsx). LFH-156.
    const geraeumt = new URLSearchParams(searchParams);
    geraeumt.delete(key);
    setSearchParams(geraeumt, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams, key, bereit]);
}
