import { useSyncExternalStore } from 'react';
import type { BenachrichtigungStufe } from '../api/types';

/**
 * Was die Alarmzone zeigt (LLH-1735, Spec `benachrichtigungen`, „Alarmzone verdeckt nichts“,
 * design.md D1 in `openspec/changes/zu9ptja2-alarmzone/`): die Einträge der Zentrale dieses Tabs,
 * älteste zuerst. Geschrieben von `useAlarmToasts`, gelesen von `AlarmZone` (oben ab `md`) und der
 * Leiste am Handschirm (`Eingangsband`). Ein Speicher je Tab genügt, denn je Tab lebt genau eine
 * Zentrale (Einsatz- oder Org-Rahmen). Beim Wechsel zwischen beiden räumt nur, wer zuletzt
 * geschrieben hat ({@link zoneRaeumen}).
 */
export interface ZonenEintrag {
  /** Fachlicher Schlüssel, etwa `b-40` oder `unwetter-…`. */
  schluessel: string;
  stufe: BenachrichtigungStufe;
  titel: string;
  /** Gegenstand und Uhrzeit, gekürzt. */
  beschreibung?: string;
  /** Ganzer Text hinter einer gekürzten Beschreibung, im `title`. */
  beschreibungVoll?: string;
  /** Kurzer Name der Art für die Zählung der gebündelten Zone („2 × Auftrag überfällig“). */
  name: string;
  /** Springt zum Bezug und quittiert. */
  oeffnen: () => void;
  /** Quittiert ohne Sprung; fehlt, wo keine Benachrichtigung dahinter steht (Unwetter). */
  gelesen?: () => void;
  /** Blendet in diesem Tab aus, ohne zu quittieren. */
  ausblenden: () => void;
}

export interface ZonenStand {
  eintraege: readonly ZonenEintrag[];
  /** Die gebündelte Zone ist aufgeklappt (ab zwei Einträgen). */
  aufgeklappt: boolean;
}

const LEER: ZonenStand = { eintraege: [], aufgeklappt: false };

let stand: ZonenStand = LEER;
let besitzerAktuell: symbol | null = null;
const hoerer = new Set<() => void>();

function setzen(neu: ZonenStand): void {
  stand = neu;
  for (const h of hoerer) h();
}

/** Die Zentrale `besitzer` zeigt diese Einträge; unter zwei klappt die Zone zu. */
export function zoneSetzen(besitzer: symbol, eintraege: readonly ZonenEintrag[]): void {
  besitzerAktuell = besitzer;
  setzen({ eintraege, aufgeklappt: eintraege.length >= 2 && stand.aufgeklappt });
}

/** Abbau einer Zentrale: nur ihre eigenen Einträge, nie die der nächsten. */
export function zoneRaeumen(besitzer: symbol): void {
  if (besitzerAktuell !== besitzer) return;
  besitzerAktuell = null;
  setzen(LEER);
}

export function zoneAufklappen(aufgeklappt: boolean): void {
  if (stand.aufgeklappt === aufgeklappt) return;
  setzen({ ...stand, aufgeklappt });
}

function abonnieren(h: () => void): () => void {
  hoerer.add(h);
  return () => hoerer.delete(h);
}

function lesen(): ZonenStand {
  return stand;
}

export function useAlarmZone(): ZonenStand {
  return useSyncExternalStore(abonnieren, lesen, lesen);
}

export function zoneZuruecksetzenFuerTests(): void {
  besitzerAktuell = null;
  stand = LEER;
}
