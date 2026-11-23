import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import type { FetchStatus } from '@tanstack/react-query';
import { parseRouteId } from './deeplinks';
import { useLinkAuftrag } from './useLinkAuftrag';

/**
 * Lage der Hinweisleiste für einen Deeplink auf ein Objekt, das es nicht (mehr) gibt (LLH-1827,
 * Change `a12ms7g9-seitenzustaende`, D5; Spec `seiten-zustaende`, „Deeplink auf ein Objekt, das es
 * nicht gibt“). Gezeichnet über `components/DeeplinkHinweis.tsx`.
 */
export interface DeeplinkHinweisLage {
  /** Die Kennung aus dem Deeplink, die es nicht gibt; `null` ohne Hinweis. */
  unbekannt: number | null;
  /**
   * Meldet eine Kennung als unbekannt, die die Seite erst später erfährt (das 404 des Einzelabrufs
   * bei Meldungen, Aufträgen, Anrufen; die zweite Suche bei Erinnerungen und Ablösungen).
   */
  melde: (id: number) => void;
  /** Räumt den Hinweis: Schließen der Leiste oder eine Wahl in der Liste. */
  schliesse: () => void;
}

/**
 * Wann ein Deeplink angewandt wird und wann ein `false` aus `anwenden` als „gibt es nicht“ zählt
 * (Review der Change `a12ms7g9-seitenzustaende`). Eine Liste aus dem Cache (Lagebild, als veraltet
 * markiert) gilt im ersten Bild schon als geladen, während ihr Neuabruf läuft; ein eben angelegtes
 * Objekt fehlt darin. Gebildet über {@link deeplinkStand}.
 */
export interface DeeplinkStand {
  /** Anwenden: jede Liste geladen, keine ruft gerade ab. */
  bereit: boolean;
  /** Ein `false` aus `anwenden` ist ein sicherer Befund: jede Liste frisch, ohne Fehler. */
  sicher: boolean;
}

/** Der Teil einer Abfrage, den {@link deeplinkStand} liest. */
export interface DeeplinkAbruf {
  isSuccess: boolean;
  fetchStatus: FetchStatus;
}

/**
 * Stand aus den Listen, gegen die `anwenden` prüft. `abrufe` tragen die Auswahl: erst wenn sie
 * geladen sind und keine mehr abruft, wird angewandt. `weitere` werden nur nachgeschlagen (die
 * Entlassenen unter der Liste): eine, die gerade lädt, wird abgewartet, eine gescheiterte hält
 * nicht auf, macht den Befund aber unsicher.
 *
 * Ohne Netz (`fetchStatus` `paused`) wird gegen den Cache angewandt, die Zeile also hervorgehoben,
 * aber nichts als unbekannt gemeldet: der Stand kann alt sein. Der Parameter wird dann still
 * geräumt, wie vor der Hinweisleiste.
 */
export function deeplinkStand(
  abrufe: readonly DeeplinkAbruf[],
  weitere: readonly DeeplinkAbruf[] = [],
): DeeplinkStand {
  const frisch = (a: DeeplinkAbruf) => a.isSuccess && a.fetchStatus === 'idle';
  return {
    bereit:
      abrufe.every((a) => a.isSuccess && a.fetchStatus !== 'fetching') &&
      weitere.every((a) => a.fetchStatus !== 'fetching'),
    sicher: abrufe.every(frisch) && weitere.every(frisch),
  };
}

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
 * wird über `searchParams`/`bereit`. Existenzprüfungen gehören in die `anwenden`-Closure: gibt es
 * das Objekt nicht, liefert sie `false`, und die zurückgegebene {@link DeeplinkHinweisLage} nennt
 * die Kennung (LLH-1827), aber nur bei einem sicheren Befund ({@link DeeplinkStand}; ein bloßes
 * `bereit` gilt als sicher). Der Param wird in jedem Fall geräumt; jeder neue Deeplink setzt die Lage
 * neu. Die Lage gilt nur auf dem Pfad, auf dem der Deeplink wirkte: ein Wechsel des Einsatzes
 * (Route ohne `key`) nimmt den Hinweis mit.
 */
export function useQueryParamSelektion(
  key: string,
  stand: boolean | DeeplinkStand,
  anwenden: (id: number) => void | false,
): DeeplinkHinweisLage {
  const bereit = typeof stand === 'boolean' ? stand : stand.bereit;
  const sicher = typeof stand === 'boolean' ? stand : stand.sicher;
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const auftrag = useLinkAuftrag();
  const [lage, setLage] = useState<{ id: number; pfad: string } | null>(null);
  useEffect(() => {
    if (!searchParams.has(key)) return;
    if (auftrag.verbraucht()) return;
    if (!bereit) return;
    const id = parseRouteId(searchParams.get(key) ?? undefined);
    const ergebnis = id != null ? anwenden(id) : undefined;
    setLage(id != null && ergebnis === false && sicher ? { id, pfad: pathname } : null);
    // Geklont statt in-place gelöscht (`useLinkAuftrag`): ein konkurrierender Default-Effekt sähe
    // den Param sonst geräumt und defaultete das Deeplink-Ziel weg.
    auftrag.raeume(key);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, auftrag, key, bereit, sicher]);
  const melde = useCallback((id: number) => setLage({ id, pfad: pathname }), [pathname]);
  const schliesse = useCallback(() => setLage(null), []);
  const unbekannt = lage != null && lage.pfad === pathname ? lage.id : null;
  return useMemo(() => ({ unbekannt, melde, schliesse }), [unbekannt, melde, schliesse]);
}
