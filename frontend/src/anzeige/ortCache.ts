/**
 * Persistenter Cache für Reverse-Geocoding (Koordinate → Ortsname) in IndexedDB, Schlüssel auf
 * ~100 m gerundet wie serverseitig. Befristet (LFH-941, design.md D7): Beim ersten Öffnen gehen
 * Einträge älter als {@link ORTCACHE_FRIST_MS}, und es bleiben höchstens
 * {@link ORTCACHE_OBERGRENZE} (die jüngsten). Ein Treffer frischt den Zeitpunkt nicht auf:
 * Ortsnamen ändern sich nicht, ein erneutes Nachschlagen nach 30 Tagen ist billiger als
 * Schreiben bei jedem Lesen. Beim Abmelden und Sitzungsende geht er ganz (LFH-767,
 * `ortCacheRaeumen`): er verrät, welche Orte im Einsatz nachgeschlagen wurden.
 * Fehler sind nie fatal: Lesen → null, Schreiben → no-op.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'lifeline-ortcache';
const STORE = 'ortsnamen';

export const ORTCACHE_FRIST_MS = 30 * 24 * 60 * 60 * 1000;
export const ORTCACHE_OBERGRENZE = 5_000;

interface OrtEintrag {
  name: string;
  /** Schreibzeitpunkt in ms (Geräteuhr). */
  at: number;
}

interface OrtCacheDB extends DBSchema {
  ortsnamen: { key: string; value: OrtEintrag; indexes: { 'by-at': number } };
}

let dbPromise: Promise<IDBPDatabase<OrtCacheDB>> | null = null;

function db(): Promise<IDBPDatabase<OrtCacheDB>> {
  if (!dbPromise) {
    // v2 (LFH-941): Wert mit Zeitstempel und Index. Der v1-Store (nackte Namen) wird verworfen —
    // ein reiner Cache, der Server hält `geocoding_cache`.
    dbPromise = openDB<OrtCacheDB>(DB_NAME, 2, {
      upgrade(d) {
        if (d.objectStoreNames.contains(STORE)) d.deleteObjectStore(STORE);
        d.createObjectStore(STORE).createIndex('by-at', 'at');
      },
    }).then(async (d) => {
      try {
        await ausduennen(d);
      } catch (e) {
        console.warn('ortCache: Ausdünnen fehlgeschlagen', e);
      }
      return d;
    });
  }
  return dbPromise;
}

/** Frist und Obergrenze, beim ersten Öffnen je Seitenaufruf, die ältesten zuerst. */
async function ausduennen(d: IDBPDatabase<OrtCacheDB>): Promise<void> {
  const tx = d.transaction(STORE, 'readwrite');
  const index = tx.store.index('by-at');
  let cursor = await index.openCursor(IDBKeyRange.upperBound(Date.now() - ORTCACHE_FRIST_MS, true));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  let ueber = (await tx.store.count()) - ORTCACHE_OBERGRENZE;
  if (ueber > 0) {
    let aelteste = await index.openCursor();
    while (aelteste && ueber > 0) {
      await aelteste.delete();
      ueber -= 1;
      aelteste = await aelteste.continue();
    }
  }
  await tx.done;
}

/** Nur für Tests: vergisst die offene Verbindung, damit das nächste Öffnen erneut ausdünnt. */
export function ortCacheZuruecksetzenFuerTests(): void {
  void dbPromise?.then((d) => d.close()).catch(() => {});
  dbPromise = null;
}

/** Gerundeter Cache-Schlüssel (3 Nachkommastellen, ~100 m). */
export function ortKeyVon(lat: number, lon: number): string {
  const r = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);
  return `${r(lat)},${r(lon)}`;
}

export async function holeOrt(key: string): Promise<string | null> {
  try {
    return (await (await db()).get(STORE, key))?.name ?? null;
  } catch (e) {
    console.warn('ortCache: Lesefehler', e);
    return null;
  }
}

export async function setzeOrt(key: string, name: string): Promise<void> {
  try {
    await (await db()).put(STORE, { name, at: Date.now() }, key);
  } catch (e) {
    console.warn('ortCache: Schreibfehler', e);
  }
}

/** Abmelden und Sitzungsende (LFH-767): leert den Store auf der Platte. Wirft bei einem
 *  Fehler — der Aufrufer (`geraetRaeumen`) protokolliert ihn und räumt die übrigen Orte. */
export async function ortCacheRaeumen(): Promise<void> {
  await (await db()).clear(STORE);
}
