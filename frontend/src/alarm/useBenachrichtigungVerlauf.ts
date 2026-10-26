import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ladeBenachrichtigungVerlauf } from '../api/benachrichtigungen';
import { einsatzKeys } from '../api/queryKeys';
import type { BenachrichtigungEreignis, BenachrichtigungVerlauf } from '../api/types';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { useAuthOptional } from '../auth/AuthContext';
import { schreibaktionenLaden } from '../offline/queue';
import { serverJetzt } from '../offline/serveruhr';
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
  const benutzerId = useAuthOptional()?.benutzer?.id;
  return useQuery({
    queryKey: einsatzKeys.benachrichtigungVerlauf(einsatzId),
    queryFn: async () => {
      const verlauf = await ladeBenachrichtigungVerlauf(einsatzId);
      return benutzerId == null ? verlauf : mitVorgemerktemGelesen(verlauf, benutzerId, einsatzId);
    },
  });
}

/**
 * Der Verlauf mit allem bis `bisId` als gelesen, wie der Server „Alle gelesen“ setzt (Spec
 * `benachrichtigungen`, „Alle gelesen“): nur offene Zeilen, nie ein Alarm. Die Zahl zählt wie der
 * Server die offenen Hinweise der Liste (LLH-1422: ohne Netz vorgemerkt, die Zahl fällt sofort).
 */
export function markVerlaufGelesen(
  verlauf: BenachrichtigungVerlauf,
  bisId: number,
): BenachrichtigungVerlauf {
  const jetzt = alsBackendZeit(serverJetzt());
  const eintraege = verlauf.eintraege.map((a) =>
    a.id <= bisId && !a.quittiert_at && a.stufe !== 'alarm' ? { ...a, quittiert_at: jetzt } : a,
  );
  const ungelesen = eintraege.filter((a) => a.stufe === 'hinweis' && !a.quittiert_at).length;
  return { eintraege, ungelesen };
}

/**
 * Legt ein vorgemerktes „Alle gelesen“ über den Serverstand (LLH-1422): kehrt das Netz zurück,
 * ruft der Rahmen den Verlauf ab, bevor der Abgleich gesendet hat, und die Zahl spränge sonst
 * zurück. Der Abgleich lädt den Verlauf neu, bevor er die Zeile entfernt
 * (`offline/useOfflineSync.ts`). Ist die Queue nicht lesbar, gilt der Serverstand.
 */
async function mitVorgemerktemGelesen(
  verlauf: BenachrichtigungVerlauf,
  benutzerId: number,
  einsatzId: number,
): Promise<BenachrichtigungVerlauf> {
  const zeilen = await schreibaktionenLaden(benutzerId, einsatzId).catch(() => []);
  const bis = Math.max(
    ...zeilen.map((z) => (z.aktion.art === 'eingaenge_gelesen' ? z.aktion.daten.bis_id : -1)),
  );
  return bis >= 0 ? markVerlaufGelesen(verlauf, bis) : verlauf;
}

/**
 * Die Zahl der ungelesenen Eingänge (design.md D8): dieselbe Zahl in Knopf, Tab-Titel und am
 * App-Symbol. Solange sie lädt oder ohne Netz nie geladen war: 0, keine Zahl (lieber keine als
 * eine erfundene). Ohne Netz gilt sonst der zuletzt geladene Stand (LLH-1422).
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
