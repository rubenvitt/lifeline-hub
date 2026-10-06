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

/** Ein Tab mit altem Bundle schreibt bis zu seinem Neuladen noch nackte Namen. */
type OrtWert = OrtEintrag | string;

interface OrtCacheDB extends DBSchema {
  ortsnamen: { key: string; value: OrtWert };
}

let dbPromise: Promise<IDBPDatabase<OrtCacheDB>> | null = null;

function db(): Promise<IDBPDatabase<OrtCacheDB>> {
  if (!dbPromise) {
    // Bewusst OHNE Versionssprung (LFH-941, design.md D7): ein Tab mit altem Bundle hielte v1
    // offen, das Upgrade hinge und mit ihm die Ortsvorschau. Deshalb kein Index, sondern
    // `{ name, at }` im v1-Store; ein nackter Name aus der Vorversion gilt als abgelaufen.
    const offen: Promise<IDBPDatabase<OrtCacheDB>> = openDB<OrtCacheDB>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE);
      },
      // Will ein neueres Bundle die DB hochstufen, gibt dieser Tab sie frei, statt es zu blockieren.
      blocking() {
        void offen.then((d) => d.close());
        if (dbPromise === offen) dbPromise = null;
      },
    }).then(async (d) => {
      try {
        await ausduennen(d);
      } catch (e) {
        console.warn('ortCache: Ausdünnen fehlgeschlagen', e);
      }
      return d;
    });
    dbPromise = offen;
  }
  return dbPromise;
}

function zeitpunkt(wert: OrtWert): number {
  return typeof wert === 'string' ? 0 : wert.at;
}

/** Frist und Obergrenze, beim ersten Öffnen je Seitenaufruf, die ältesten zuerst. Ohne Index
 *  liest es einmal alle Einträge; bei höchstens 5 000 kleinen Werten ist das billig. */
async function ausduennen(d: IDBPDatabase<OrtCacheDB>): Promise<void> {
  const tx = d.transaction(STORE, 'readwrite');
  const [schluessel, werte] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  const grenze = Date.now() - ORTCACHE_FRIST_MS;
  const nachAlter = schluessel
    .map((key, i) => ({ key, at: zeitpunkt(werte[i]) }))
    .sort((a, b) => a.at - b.at);
  const ueber = Math.max(0, nachAlter.length - ORTCACHE_OBERGRENZE);
  const weg = nachAlter.filter((e, i) => i < ueber || e.at < grenze);
  await Promise.all([...weg.map((e) => tx.store.delete(e.key)), tx.done]);
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
    const wert = await (await db()).get(STORE, key);
    if (wert === undefined) return null;
    return typeof wert === 'string' ? wert : wert.name;
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
