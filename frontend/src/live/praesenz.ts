import { useSyncExternalStore } from 'react';
import { ApiError, apiSend, apiSendKeepalive } from '../api/client';
import type { PraesenzObjekt, PraesenzStand } from '../api/types';
import { useAuthOptional } from '../auth/AuthContext';
import { neueClientId } from '../offline/clientId';
import { useOhneVerbindung } from '../offline/verbindung';

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
export const FENSTER_ID: string = neueClientId();

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
 * zählt jede Überschneidung mit `s.felder`. Das eigene Konto in einem anderen Fenster ist `eigenesKonto`.
 */
export function praesenzAnderer(
  stand: PraesenzStand | undefined,
  s: PraesenzSchluessel,
  feld: string | undefined,
  benutzerId: number | undefined,
): { andere: string[]; eigenesKonto: boolean } {
  const andere: string[] = [];
  let eigenesKonto = false;
  for (const e of stand?.eintraege ?? []) {
    if (e.objekt !== s.objekt) continue;
    if ((e.einheit_id ?? undefined) !== s.einheitId) continue;
    const trifft = feld ? e.felder.includes(feld) : e.felder.some((f) => s.felder.includes(f));
    if (!trifft) continue;
    if (e.benutzer_id === benutzerId) {
      if (e.fenster !== FENSTER_ID) eigenesKonto = true;
      continue;
    }
    if (!andere.includes(e.von)) andere.push(e.von);
  }
  return { andere, eigenesKonto };
}

function abonnieren(h: () => void): () => void {
  hoerer.add(h);
  return () => hoerer.delete(h);
}

/**
 * Hook zu {@link praesenzAnderer} mit dem angemeldeten Benutzer. Ohne Verbindung nichts: der Stand
 * ist dann nicht mehr verlässlich (Entwurf D5, „ein Abbruch leert den Stand“).
 */
export function usePraesenzAnderer(
  s: PraesenzSchluessel | undefined,
  feld?: string,
): { andere: string[]; eigenesKonto: boolean } {
  const benutzerId = useAuthOptional()?.benutzer?.id;
  const ohneNetz = useOhneVerbindung();
  const stand = useSyncExternalStore(abonnieren, () => (s ? staende.get(s.einsatzId) : undefined));
  if (!s || ohneNetz) return KEINE;
  return praesenzAnderer(stand, s, feld, benutzerId);
}

const KEINE = { andere: [] as string[], eigenesKonto: false };

/**
 * Der Satz am Feld (Entwurf D6); `null`, wenn niemand sonst bearbeitet.
 */
export function praesenzSatz(andere: readonly string[], eigenesKonto: boolean): string | null {
  // Ohne Anrede (LLH-1830, `src/anredeText.guard.test.ts`).
  const anderesFenster = 'in einem anderen Fenster dieses Kontos';
  if (andere.length === 0) return eigenesKonto ? `Wird gerade ${anderesFenster} bearbeitet` : null;
  const namen =
    andere.length === 1
      ? andere[0]
      : andere.length === 2
        ? `${andere[0]} und ${andere[1]}`
        : `${andere[0]} und ${andere.length - 1} weiteren`;
  return eigenesKonto
    ? `Wird gerade bearbeitet von ${namen} und ${anderesFenster}`
    : `Wird gerade bearbeitet von ${namen}`;
}

function pfad(s: PraesenzSchluessel): string {
  return s.objekt === 'einheit'
    ? `/api/incidents/${s.einsatzId}/units/${s.einheitId}/presence`
    : `/api/incidents/${s.einsatzId}/presence`;
}

function meldung(s: PraesenzSchluessel) {
  return s.objekt === 'einheit'
    ? { felder: s.felder, fenster: FENSTER_ID }
    : { objekt: s.objekt, felder: s.felder, fenster: FENSTER_ID };
}

/**
 * Beginnt oder verlängert die Präsenz dieses Fensters. `false`, wenn der Server die Meldung
 * ablehnt (412 anderes Konto, 403 ohne Recht, 404 weg, 400/409): dann hört der Takt auf
 * (Entwurf D5). Ein Netzfehler zählt nicht, der nächste Takt versucht es wieder. Still: Präsenz ist
 * ein Hinweis, ein Fehler ändert an der Eingabe nichts.
 */
export async function meldePraesenz(s: PraesenzSchluessel): Promise<boolean> {
  try {
    await apiSend<void>(pfad(s), 'PUT', meldung(s));
    return true;
  } catch (e) {
    return !(e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429);
  }
}

/** Beendet die Präsenz dieses Fensters; `beimVerlassen` überlebt das Ende der Seite. */
export function beendePraesenz(s: PraesenzSchluessel, beimVerlassen = false): void {
  const body = meldung(s);
  const senden = beimVerlassen
    ? apiSendKeepalive(pfad(s), body, 'DELETE')
    : apiSend<void>(pfad(s), 'DELETE', body);
  senden.catch(() => {
    /* still: der Server lässt den Eintrag ohnehin ablaufen. */
  });
}
