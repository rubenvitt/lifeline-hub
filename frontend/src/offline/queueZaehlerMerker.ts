import { sicherEntfernen, sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';
import type { OfflineQueueZaehler } from './queue';

/**
 * Der zuletzt gelesene Zähler der Offline-Queue (LLH-1910,
 * `openspec/changes/archive/2026-11-16-s11g6ijy-kopfleiste-startzustaende/design.md` D2/D3). Die
 * Queue liegt in IndexedDB und antwortet erst nach dem ersten Bild; ohne diesen Merker erschien
 * „n NICHT GESENDET“ (früher „WARTET n“) bzw. „PRÜFEN“ erst danach, und der Kopf brach an der
 * Umbruchkante in eine zweite Zeile um (Spec `kopfleiste`).
 *
 * Ein Platz für die zuletzt aktive Person, nur Zahlen und ihre Kennung. Jeder Ausgang räumt ihn
 * (`GERAETESPEICHER`, `jeder-ausgang`); die Queue selbst bleibt und füllt ihn wieder.
 */
export const QUEUE_ZAEHLER_MERKER = 'lfh:queue-zaehler';

const isAnzahl = (wert: unknown): wert is number =>
  typeof wert === 'number' && Number.isInteger(wert) && wert >= 0;

/** Der gemerkte Stand dieser Person, sonst `null` (fremd, fehlt, unlesbar). Wirft nie. */
export function loadStoredQueueZaehler(benutzerId: number): OfflineQueueZaehler | null {
  const roh = sicherLesen(QUEUE_ZAEHLER_MERKER);
  if (roh === null) return null;
  let wert: unknown;
  try {
    wert = JSON.parse(roh);
  } catch {
    return null;
  }
  if (typeof wert !== 'object' || wert === null) return null;
  const { benutzer_id, ausstehend, abgelehnt, nicht_zugeordnet } = wert as Record<string, unknown>;
  if (benutzer_id !== benutzerId) return null;
  if (!isAnzahl(ausstehend) || !isAnzahl(abgelehnt) || !isAnzahl(nicht_zugeordnet)) return null;
  return { ausstehend, abgelehnt, nicht_zugeordnet };
}

/** Merkt den gelesenen Stand, auch einen leeren: sonst bliebe eine abgebaute Queue stehen. */
export function saveQueueZaehler(benutzerId: number, wert: OfflineQueueZaehler): void {
  sicherSchreiben(
    QUEUE_ZAEHLER_MERKER,
    JSON.stringify({
      benutzer_id: benutzerId,
      ausstehend: wert.ausstehend,
      abgelehnt: wert.abgelehnt,
      nicht_zugeordnet: wert.nicht_zugeordnet,
    }),
  );
}

/** Räumt den Merker (jeder Ausgang, `offline/geraetRaeumung.ts`). */
export function queueZaehlerMerkerRaeumen(): void {
  sicherEntfernen(QUEUE_ZAEHLER_MERKER);
}
