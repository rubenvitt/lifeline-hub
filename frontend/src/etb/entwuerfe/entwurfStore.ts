import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EtbEntwurf } from './entwurfModell';

interface EntwurfDB extends DBSchema {
  entwuerfe: {
    key: string;
    value: EtbEntwurf;
    indexes: { 'by-einsatz': number };
  };
}

let dbPromise: Promise<IDBPDatabase<EntwurfDB>> | null = null;

function db(): Promise<IDBPDatabase<EntwurfDB>> {
  if (!dbPromise) {
    dbPromise = openDB<EntwurfDB>('lifeline-etb-entwuerfe', 1, {
      upgrade(d) {
        const store = d.createObjectStore('entwuerfe', { keyPath: 'id' });
        store.createIndex('by-einsatz', 'einsatz_id');
      },
    });
  }
  return dbPromise;
}

/** Entwürfe eines Einsatzes, aufsteigend nach erstellt_at (älteste zuerst → stabile Tab-Reihenfolge). */
export async function entwuerfeLaden(einsatzId: number): Promise<EtbEntwurf[]> {
  const d = await db();
  const alle = await d.getAllFromIndex('entwuerfe', 'by-einsatz', einsatzId);
  return alle.sort((a, b) => a.erstellt_at.localeCompare(b.erstellt_at));
}

export async function entwurfSpeichern(entwurf: EtbEntwurf): Promise<void> {
  const d = await db();
  await d.put('entwuerfe', entwurf);
}

export async function entwurfEntfernen(id: string): Promise<void> {
  const d = await db();
  await d.delete('entwuerfe', id);
}

/** Nur für Tests: leert den Store (fake-indexeddb persistiert sonst zwischen Tests). */
export async function entwuerfeLeerenFuerTests(): Promise<void> {
  const d = await db();
  await d.clear('entwuerfe');
}
