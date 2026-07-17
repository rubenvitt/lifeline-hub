import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { NeuerEintrag } from '../api/etb';

export interface AusstehenderEintrag {
  id?: number;
  einsatz_id: number;
  eintrag: NeuerEintrag;
  erstellt_at: string;
}

/** Endgültig fachlich abgelehnter Offline-Eintrag. Persistent (eigener Store), damit
 *  der Verlust nach einem Reload sichtbar bleibt und der Nutzer ihn bewusst verwerfen
 *  oder neu erfassen kann — statt still in flüchtigem React-State zu verschwinden. */
export interface AbgelehnterEintrag {
  id?: number;
  einsatz_id: number;
  eintrag: NeuerEintrag;
  grund: string;
  abgelehnt_at: string;
}

interface OfflineDB extends DBSchema {
  ausstehend: {
    key: number;
    value: AusstehenderEintrag;
    indexes: { 'by-einsatz': number };
  };
  abgelehnt: {
    key: number;
    value: AbgelehnterEintrag;
    indexes: { 'by-einsatz': number };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function db(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    // v2 (F03/LFH-261): `abgelehnt`-Store dazugenommen. Jeder Store wird versionsgeguardet
    // angelegt, damit der upgrade-Callback auf einer Bestands-v1-DB nicht createObjectStore
    // für `ausstehend` erneut aufruft (das würde werfen).
    dbPromise = openDB<OfflineDB>('lifeline-offline', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const store = d.createObjectStore('ausstehend', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-einsatz', 'einsatz_id');
        }
        if (oldVersion < 2) {
          const store = d.createObjectStore('abgelehnt', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-einsatz', 'einsatz_id');
        }
      },
    });
  }
  return dbPromise;
}

export async function queueEinreihen(einsatzId: number, eintrag: NeuerEintrag): Promise<void> {
  const d = await db();
  // Idempotenzschlüssel garantieren: der Hook mintet ihn schon beim Online-Versuch und reicht
  // ihn durch (damit online↔flush dieselbe Id tragen); fehlt er dennoch, minten wir hier als
  // Fallback — aber wir überschreiben NIE einen vorhandenen.
  const mitId: NeuerEintrag = {
    ...eintrag,
    client_id: eintrag.client_id ?? crypto.randomUUID(),
  };
  await d.add('ausstehend', {
    einsatz_id: einsatzId,
    eintrag: mitId,
    erstellt_at: new Date().toISOString(),
  });
}

/** Ausstehende Einträge eines Einsatzes in Einreihungs-Reihenfolge (aufsteigende id). */
export async function queueLaden(einsatzId: number): Promise<AusstehenderEintrag[]> {
  const d = await db();
  const alle = await d.getAllFromIndex('ausstehend', 'by-einsatz', einsatzId);
  return alle.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function queueEntfernen(id: number): Promise<void> {
  const d = await db();
  await d.delete('ausstehend', id);
}

/** Legt einen fachlich abgelehnten Eintrag persistent ab (überlebt Reload). */
export async function abgelehntHinzufuegen(
  einsatzId: number,
  eintrag: NeuerEintrag,
  grund: string,
): Promise<void> {
  const d = await db();
  await d.add('abgelehnt', {
    einsatz_id: einsatzId,
    eintrag,
    grund,
    abgelehnt_at: new Date().toISOString(),
  });
}

/** Abgelehnte Einträge eines Einsatzes in Reihenfolge (aufsteigende id). */
export async function abgelehntLaden(einsatzId: number): Promise<AbgelehnterEintrag[]> {
  const d = await db();
  const alle = await d.getAllFromIndex('abgelehnt', 'by-einsatz', einsatzId);
  return alle.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function abgelehntEntfernen(id: number): Promise<void> {
  const d = await db();
  await d.delete('abgelehnt', id);
}

/** Nur für Tests: leert beide Stores (gleiche Verbindung, kein Reconnect nötig). */
export async function queueLeerenFuerTests(): Promise<void> {
  const d = await db();
  await d.clear('ausstehend');
  await d.clear('abgelehnt');
}
