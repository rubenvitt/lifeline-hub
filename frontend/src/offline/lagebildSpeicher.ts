import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore } from 'idb';
import type { PersistedClient } from '@tanstack/query-persist-client-core';
import type { BenutzerAnzeige } from '../api/types';

/**
 * Geräteseitiger Stand des Lagebilds (LFH-723, design.md D1).
 *
 * Eine EIGENE Datenbank neben `lifeline-offline`: die Offline-Queue ist Beweissicherung und
 * darf von keinem Löschweg dieses Moduls erreicht werden. Genau EIN Datensatz, weil ein Gerät
 * immer nur einen angemeldeten Benutzer hat — ein Wechsel löscht, statt einen zweiten
 * Datensatz daneben zu legen.
 *
 * Jeder Zugriff fängt seine Fehler selbst: ohne IndexedDB (privates Fenster, blockierte
 * Website-Daten) gibt es schlicht keine Vorhaltung, und die App verhält sich wie vorher. Ein
 * Wurf nach außen hielte sonst den Start im `AuthProvider` fest.
 */
export const LAGEBILD_DB = 'lifeline-lagebild';
const STORE = 'stand';
/** Identität, Bestätigung und Version — klein, von Bestätigung und Identitätsprüfung gelesen. */
const KOPF = 'kopf';
/** Der dehydrierte Stand — groß, nur beim Speichern und Lesen angefasst (LFH-939 D2). */
const CLIENT = 'client';
/** Datensatz vor LFH-939: alles unter einem Schlüssel. Anlegen und Löschen nehmen ihn mit. */
const ALT = 'aktuell';

export interface LagebildDatensatz {
  /** Zuletzt vom Server bestätigter Benutzer — die Offline-Identität (D2). */
  benutzer: BenutzerAnzeige;
  /** Letzte erfolgreiche Server-Antwort in ms. Daran hängt die Höchstliegezeit (D4), NICHT
   *  am Speicherzeitpunkt `client.timestamp`. */
  bestaetigtAt: number;
  /** App-Version, unter der der Stand geschrieben wurde. */
  buster: string;
  client: PersistedClient;
}

type LagebildKopf = Omit<LagebildDatensatz, 'client'>;

interface LagebildDB extends DBSchema {
  stand: { key: string; value: LagebildKopf | PersistedClient };
}

let dbPromise: Promise<IDBPDatabase<LagebildDB>> | null = null;

function db(): Promise<IDBPDatabase<LagebildDB>> {
  if (!dbPromise) {
    // Kopf und Stand unter getrennten Schlüsseln im selben Store (LFH-939 D2) — bewusst OHNE
    // Versionssprung: ein Tab mit altem Bundle hielte v1 offen, das Upgrade hinge und mit ihm
    // die Anmeldung. Den Altdatensatz `aktuell` nehmen Anlegen und Löschen mit.
    const offen: Promise<IDBPDatabase<LagebildDB>> = openDB<LagebildDB>(LAGEBILD_DB, 1, {
      upgrade(d) {
        d.createObjectStore(STORE);
      },
      // Will ein neueres Bundle die DB hochstufen, gibt dieser Tab sie frei, statt es zu blockieren.
      blocking() {
        void offen.then((d) => d.close());
        if (dbPromise === offen) dbPromise = null;
      },
    }).catch((fehler: unknown) => {
      // Beim nächsten Zugriff neu versuchen statt dauerhaft an einer gescheiterten Öffnung
      // zu hängen.
      dbPromise = null;
      throw fehler;
    });
    dbPromise = offen;
  }
  return dbPromise;
}

/** Nur für Tests: vergisst die offene Verbindung, damit ein Test das Öffnen scheitern lassen
 *  kann. */
export function lagebildSpeicherZuruecksetzenFuerTests(): void {
  void dbPromise?.then((d) => d.close()).catch(() => {});
  dbPromise = null;
}

function melde(was: string, fehler: unknown): void {
  console.warn(`Lagebild-Speicher: ${was} fehlgeschlagen — ohne Vorhaltung weiter`, fehler);
}

export async function lagebildLesen(): Promise<LagebildDatensatz | undefined> {
  try {
    const tx = (await db()).transaction(STORE, 'readonly');
    const [kopf, client] = await Promise.all([tx.store.get(KOPF), tx.store.get(CLIENT), tx.done]);
    if (!kopf || !client) return undefined;
    return { ...(kopf as LagebildKopf), client: client as PersistedClient };
  } catch (fehler) {
    melde('Lesen', fehler);
    return undefined;
  }
}

/** Legt den Datensatz an oder ersetzt ihn ganz. Nur beim Start und bei der Anmeldung (D1). */
export async function lagebildAnlegen(satz: LagebildDatensatz): Promise<void> {
  try {
    const { client, ...kopf } = satz;
    const tx = (await db()).transaction(STORE, 'readwrite');
    await Promise.all([
      tx.store.put(kopf, KOPF),
      tx.store.put(client, CLIENT),
      tx.store.delete(ALT),
      tx.done,
    ]);
  } catch (fehler) {
    melde('Anlegen', fehler);
  }
}

/**
 * Prüft im Kopf die Identität und schreibt dann — nie legt es einen Datensatz an.
 *
 * Lesen und Schreiben laufen in EINER Transaktion: zwischen beiden könnte sonst ein anderer
 * Tab löschen, und dieser schriebe den gelöschten Stand zurück — nach dem Abmelden stünde
 * wieder ein Stand auf der Platte (design.md D1, Mehrtab). Gelesen wird nur der kleine Kopf,
 * nie der Stand (LFH-939 D2).
 */
async function wennEigen(
  benutzerId: number,
  schreiben: (
    kopf: LagebildKopf,
    store: IDBPObjectStore<LagebildDB, ['stand'], 'stand', 'readwrite'>,
  ) => Promise<unknown>,
): Promise<void> {
  try {
    const tx = (await db()).transaction(STORE, 'readwrite');
    const kopf = (await tx.store.get(KOPF)) as LagebildKopf | undefined;
    if (kopf && kopf.benutzer.id === benutzerId) await schreiben(kopf, tx.store);
    await tx.done;
  } catch (fehler) {
    melde('Schreiben', fehler);
  }
}

export function lagebildClientSchreiben(benutzerId: number, client: PersistedClient) {
  return wennEigen(benutzerId, (_kopf, store) => store.put(client, CLIENT));
}

export function lagebildBestaetigen(benutzerId: number, zeitpunkt: number) {
  return wennEigen(benutzerId, (kopf, store) =>
    store.put({ ...kopf, bestaetigtAt: Math.max(kopf.bestaetigtAt, zeitpunkt) }, KOPF),
  );
}

/** Löscht den Datensatz. Die Datenbank bleibt stehen, leer. */
export async function lagebildLoeschenPlatte(): Promise<void> {
  try {
    const tx = (await db()).transaction(STORE, 'readwrite');
    await Promise.all([
      tx.store.delete(KOPF),
      tx.store.delete(CLIENT),
      tx.store.delete(ALT),
      tx.done,
    ]);
  } catch (fehler) {
    melde('Löschen', fehler);
  }
}
