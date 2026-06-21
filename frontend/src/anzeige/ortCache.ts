/**
 * Persistenter, quasi-permanenter Local-Cache für Reverse-Geocoding-Ergebnisse
 * (Koordinate → Ortsname) in IndexedDB. Schlüssel auf ~100 m gerundet, identisch zur
 * serverseitigen Rundung. Ortsnamen sind faktisch unveränderlich → kein Eviction.
 * Fehler sind nie fatal: Lesen → null, Schreiben → no-op (geloggt).
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'lifeline-ortcache';
const STORE = 'ortsnamen';
let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

/** Gerundeter Cache-Schlüssel (3 Nachkommastellen, ~100 m). */
export function ortKeyVon(lat: number, lon: number): string {
  const r = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);
  return `${r(lat)},${r(lon)}`;
}

export async function holeOrt(key: string): Promise<string | null> {
  try {
    return (await (await db()).get(STORE, key)) ?? null;
  } catch (e) {
    console.warn('ortCache: Lesefehler', e);
    return null;
  }
}

export async function setzeOrt(key: string, name: string): Promise<void> {
  try {
    await (await db()).put(STORE, name, key);
  } catch (e) {
    console.warn('ortCache: Schreibfehler', e);
  }
}
