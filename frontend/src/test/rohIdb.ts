import { openDB } from 'idb';

/**
 * Liest einen Store über eine EIGENE Verbindung, ohne Version und ohne die Modulfunktionen
 * (LFH-767): Ein Räumtest soll die Platte sehen, nicht einen Cache oder einen Index, der
 * fremde Zeilen nur ausblendet. Die Verbindung wird gleich wieder geschlossen, sonst blockierte
 * sie ein späteres Upgrade.
 */
export async function rohLesen(dbName: string, store: string): Promise<unknown[]> {
  const d = await openDB(dbName);
  try {
    if (!d.objectStoreNames.contains(store)) return [];
    return await d.getAll(store);
  } finally {
    d.close();
  }
}
