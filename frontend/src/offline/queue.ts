import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { NeuerEintrag } from '../api/etb';

export interface AusstehenderEintrag {
  id?: number;
  einsatz_id: number;
  eintrag: NeuerEintrag;
  erstellt_at: string;
}

interface OfflineDB extends DBSchema {
  ausstehend: {
    key: number;
    value: AusstehenderEintrag;
    indexes: { 'by-einsatz': number };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function db(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>('lifeline-offline', 1, {
      upgrade(d) {
        const store = d.createObjectStore('ausstehend', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-einsatz', 'einsatz_id');
      },
    });
  }
  return dbPromise;
}

export async function queueEinreihen(einsatzId: number, eintrag: NeuerEintrag): Promise<void> {
  const d = await db();
  await d.add('ausstehend', {
    einsatz_id: einsatzId,
    eintrag,
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

/** Nur für Tests: leert den Store (gleiche Verbindung, kein Reconnect nötig). */
export async function queueLeerenFuerTests(): Promise<void> {
  const d = await db();
  await d.clear('ausstehend');
}
