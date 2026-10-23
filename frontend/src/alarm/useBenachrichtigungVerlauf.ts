import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ladeBenachrichtigungVerlauf } from '../api/benachrichtigungen';
import { einsatzKeys } from '../api/queryKeys';
import type { BenachrichtigungEreignis } from '../api/types';
import {
  BENACHRICHTIGUNG_WINDOW_EVENT,
  NACHREICHEN_WINDOW_EVENT,
} from '../live/benachrichtigungListener';
import { erzeugeLiveSammler } from '../live/liveInvalidierung';

/**
 * Der Verlauf der eigenen Benachrichtigungen eines Einsatzes (LLH-1143, design.md D3): Knopf
 * „Eingänge“, Tab-Titel und App-Badge lesen denselben Key, also EINEN Abruf. Abgeglichen wird er
 * nur über {@link useVerlaufAbgleich}, den genau eine Stelle des Rahmens ruft.
 */
export function useBenachrichtigungVerlauf(einsatzId: number) {
  return useQuery({
    queryKey: einsatzKeys.benachrichtigungVerlauf(einsatzId),
    queryFn: () => ladeBenachrichtigungVerlauf(einsatzId),
  });
}

/**
 * Die Zahl der ungelesenen Eingänge (design.md D8): dieselbe Zahl in Knopf, Tab-Titel und am
 * App-Symbol. Solange sie lädt oder ohne Netz: 0, keine Zahl (lieber keine als eine erfundene).
 */
export function useUngeleseneEingaenge(einsatzId: number): number {
  return useBenachrichtigungVerlauf(einsatzId).data?.ungelesen ?? 0;
}

/**
 * Gleicht den Verlauf bei jedem Benachrichtigungs-Ereignis dieses Einsatzes ab — neu, quittiert,
 * still, „alle gelesen“ — und beim Nachreichen (`lagged`, Neuaufbau). Das Ereignis
 * `benachrichtigung` ist empfängergebunden und steht nicht in `EINSATZ_STREAM_EVENTS`; deshalb
 * hört hier der Rahmen selbst zu, über einen eigenen Sammler (`frontend/AGENTS.md`,
 * Query-Key-Registry: Live-Ereignisse invalidieren nur über den Sammler).
 */
export function useVerlaufAbgleich(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    const sammler = erzeugeLiveSammler(qc);
    const key = einsatzKeys.benachrichtigungVerlauf(einsatzId);
    const beiEreignis = (ev: Event) => {
      const e = (ev as CustomEvent<BenachrichtigungEreignis>).detail;
      if (e?.einsatz_id === einsatzId) sammler.vormerken(key);
    };
    const beiNachreichen = () => sammler.vormerken(key);
    window.addEventListener(BENACHRICHTIGUNG_WINDOW_EVENT, beiEreignis);
    window.addEventListener(NACHREICHEN_WINDOW_EVENT, beiNachreichen);
    return () => {
      window.removeEventListener(BENACHRICHTIGUNG_WINDOW_EVENT, beiEreignis);
      window.removeEventListener(NACHREICHEN_WINDOW_EVENT, beiNachreichen);
      sammler.raeumen();
    };
  }, [einsatzId, qc]);
}
