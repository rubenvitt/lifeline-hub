import type { BenachrichtigungEreignis, LiveEvent, OrgLiveEvent } from '../api/types';

/**
 * Wire-Name der Benachrichtigung auf dem Einsatz-Strom. Empfängergebunden und ohne Cache-Bezug,
 * deshalb nicht in `EINSATZ_STREAM_EVENTS` (Vertrag: `api/liveEvent.contract.test.ts`).
 */
export const BENACHRICHTIGUNG_EREIGNIS = 'benachrichtigung' as const satisfies LiveEvent;
/** Wire-Name der Org-Arten auf dem Org-Kanal und im Org-Anteil des Einsatz-Stroms. */
export const ORG_BENACHRICHTIGUNG_EREIGNIS = 'org_benachrichtigung' as const satisfies OrgLiveEvent;

/**
 * window-Ereignis, das die Zentrale (`alarm/useBenachrichtigungen.ts`) empfängt. Der Strom
 * leitet nur weiter: Text, Ton und Toast entscheidet die Zentrale, die im Layout hängt. Das
 * Geräte-Layout hat keine, dort verhallt das Ereignis (der Server schließt Geräte ohnehin aus).
 */
export const BENACHRICHTIGUNG_WINDOW_EVENT = 'lfh:benachrichtigung';
/** Bittet die Zentrale, die offene Liste zu holen (design.md D5, Nachreichen). */
export const NACHREICHEN_WINDOW_EVENT = 'lfh:benachrichtigungen-nachreichen';

function weiterleiten(ev: MessageEvent): void {
  let detail: BenachrichtigungEreignis;
  try {
    detail = JSON.parse(ev.data) as BenachrichtigungEreignis;
  } catch {
    return;
  }
  if (detail == null || typeof detail.benachrichtigung_id !== 'number') return;
  window.dispatchEvent(new CustomEvent(BENACHRICHTIGUNG_WINDOW_EVENT, { detail }));
}

/**
 * Listener für beide Benachrichtigungs-Ereignisse. `nurOrg` nimmt nur das Org-Ereignis (Org-Kanal);
 * der Einsatz-Strom trägt beide.
 */
export function benachrichtigungListener(nurOrg: boolean = false): [string, EventListener][] {
  const listener = weiterleiten as EventListener;
  return nurOrg
    ? [[ORG_BENACHRICHTIGUNG_EREIGNIS, listener]]
    : [
        [BENACHRICHTIGUNG_EREIGNIS, listener],
        [ORG_BENACHRICHTIGUNG_EREIGNIS, listener],
      ];
}

/**
 * Meldet der Zentrale, dass Ereignisse verloren sein können (`lagged`, Neuaufbau, erstes Öffnen
 * nach einem Endzustand). Sie holt dann die offene Liste und zeigt, was der Tab noch nicht zeigt.
 */
export function meldeNachreichen(): void {
  window.dispatchEvent(new Event(NACHREICHEN_WINDOW_EVENT));
}
