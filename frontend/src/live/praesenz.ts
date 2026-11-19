import { useSyncExternalStore } from 'react';
import { apiSend, apiSendKeepalive } from '../api/client';
import type { PraesenzObjekt, PraesenzStand } from '../api/types';
import { useAuthOptional } from '../auth/AuthContext';

/**
 * Präsenz an Einzelangaben (LLH-1946, Entwurf
 * `docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md`, D5): wer gerade welche
 * Angabe von Einsatzkopf, Führungsstelle oder Einheit offen hat.
 *
 * Der Stand kommt als ganzer über das Live-Ereignis `praesenz` und liegt hier in einem kleinen
 * Store je Einsatz, nicht im Query-Cache (kein Query-Key, `frontend/AGENTS.md`). Bricht der Strom
 * ab, wird er geleert; der Server schickt beim Verbinden den aktuellen Stand.
 */

/** Wire-Name des Ereignisses; außerhalb der Cache-Registry (`api/liveEvent.contract.test.ts`). */
export const PRAESENZ_EREIGNIS = 'praesenz' as const;

/** Takt der Lebenszeichen einer offenen Eingabe; der Server lässt nach 45 s ablaufen. */
export const PRAESENZ_TAKT_MS = 15_000;

/** Kennung dieses Tabs, einmal je Laden; nie gespeichert. */
export const FENSTER_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `f-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

/** Welche Angaben eine Eingabe bearbeitet. */
export type PraesenzSchluessel = {
  einsatzId: number;
  objekt: PraesenzObjekt;
  einheitId?: number;
  felder: readonly string[];
};

const staende = new Map<number, PraesenzStand>();
const hoerer = new Set<() => void>();

function melden(): void {
  for (const h of hoerer) h();
}

/** Der zuletzt empfangene Stand eines Einsatzes (für Tests und Hooks). */
export function praesenzStand(einsatzId: number): PraesenzStand | undefined {
  return staende.get(einsatzId);
}

/** Leert den Stand eines Einsatzes, etwa wenn sein Strom abbricht. */
export function leerePraesenz(einsatzId: number): void {
  if (staende.delete(einsatzId)) melden();
}

/** Listener des Einsatzstroms für `praesenz`; übernimmt nur den Stand dieses Einsatzes. */
export function praesenzListener(einsatzId: number): [string, EventListener][] {
  const listener = (ev: Event) => {
    let stand: PraesenzStand;
    try {
      stand = JSON.parse((ev as MessageEvent).data) as PraesenzStand;
    } catch {
      return;
    }
    if (stand == null || stand.einsatz_id !== einsatzId || !Array.isArray(stand.eintraege)) return;
    staende.set(einsatzId, stand);
    melden();
  };
  return [[PRAESENZ_EREIGNIS, listener]];
}

/**
 * Wer außer diesem Fenster die Angabe gerade bearbeitet. `feld` grenzt auf eine Zeile ein; ohne
 * zählt jede Überschneidung mit `s.felder`. Das eigene Konto in einem anderen Fenster ist `du`.
 */
export function praesenzAnderer(
  stand: PraesenzStand | undefined,
  s: PraesenzSchluessel,
  feld: string | undefined,
  benutzerId: number | undefined,
): { andere: string[]; du: boolean } {
  const andere: string[] = [];
  let du = false;
  for (const e of stand?.eintraege ?? []) {
    if (e.objekt !== s.objekt) continue;
    if ((e.einheit_id ?? undefined) !== s.einheitId) continue;
    const trifft = feld ? e.felder.includes(feld) : e.felder.some((f) => s.felder.includes(f));
    if (!trifft) continue;
    if (e.benutzer_id === benutzerId) {
      if (e.fenster !== FENSTER_ID) du = true;
      continue;
    }
    if (!andere.includes(e.von)) andere.push(e.von);
  }
  return { andere, du };
}

function abonnieren(h: () => void): () => void {
  hoerer.add(h);
  return () => hoerer.delete(h);
}

/** Hook zu {@link praesenzAnderer} mit dem angemeldeten Benutzer. */
export function usePraesenzAnderer(
  s: PraesenzSchluessel | undefined,
  feld?: string,
): { andere: string[]; du: boolean } {
  const benutzerId = useAuthOptional()?.benutzer?.id;
  const stand = useSyncExternalStore(abonnieren, () => (s ? staende.get(s.einsatzId) : undefined));
  if (!s) return KEINE;
  return praesenzAnderer(stand, s, feld, benutzerId);
}

const KEINE = { andere: [] as string[], du: false };

/**
 * Der Satz am Feld (Entwurf D6); `null`, wenn niemand sonst bearbeitet.
 */
export function praesenzSatz(andere: readonly string[], du: boolean): string | null {
  const dich = 'von dir in einem anderen Fenster';
  if (andere.length === 0) return du ? `Wird gerade ${dich} bearbeitet` : null;
  const namen =
    andere.length === 1
      ? andere[0]
      : andere.length === 2
        ? `${andere[0]} und ${andere[1]}`
        : `${andere[0]} und ${andere.length - 1} weiteren`;
  return du
    ? `Wird gerade bearbeitet von ${namen} und ${dich}`
    : `Wird gerade bearbeitet von ${namen}`;
}

function pfad(s: PraesenzSchluessel): string {
  return s.objekt === 'einheit'
    ? `/api/einsaetze/${s.einsatzId}/einheiten/${s.einheitId}/praesenz`
    : `/api/einsaetze/${s.einsatzId}/praesenz`;
}

/** Beginnt oder verlängert die Präsenz dieses Fensters. Fehler bleiben still. */
export async function meldePraesenz(s: PraesenzSchluessel): Promise<void> {
  const body =
    s.objekt === 'einheit'
      ? { felder: s.felder, fenster: FENSTER_ID }
      : { objekt: s.objekt, felder: s.felder, fenster: FENSTER_ID };
  try {
    await apiSend<void>(pfad(s), 'PUT', body);
  } catch {
    /* Präsenz ist ein Hinweis; ein Fehler ändert an der Eingabe nichts. */
  }
}

/** Beendet die Präsenz dieses Fensters; `beimVerlassen` überlebt das Ende der Seite. */
export function beendePraesenz(s: PraesenzSchluessel, beimVerlassen = false): void {
  const body = { fenster: FENSTER_ID };
  const senden = beimVerlassen
    ? apiSendKeepalive(pfad(s), body, 'DELETE')
    : apiSend<void>(pfad(s), 'DELETE', body);
  senden.catch(() => {
    /* still: der Server lässt den Eintrag ohnehin ablaufen. */
  });
}
