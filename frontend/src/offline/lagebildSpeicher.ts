import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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
const SCHLUESSEL = 'aktuell';

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

interface LagebildDB extends DBSchema {
  stand: { key: string; value: LagebildDatensatz };
}

let dbPromise: Promise<IDBPDatabase<LagebildDB>> | null = null;

function db(): Promise<IDBPDatabase<LagebildDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LagebildDB>(LAGEBILD_DB, 1, {
      upgrade(d) {
        d.createObjectStore(STORE);
      },
    }).catch((fehler: unknown) => {
      // Beim nächsten Zugriff neu versuchen statt dauerhaft an einer gescheiterten Öffnung
      // zu hängen.
      dbPromise = null;
      throw fehler;
    });
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
    return await (await db()).get(STORE, SCHLUESSEL);
  } catch (fehler) {
    melde('Lesen', fehler);
    return undefined;
  }
}

/** Legt den Datensatz an oder ersetzt ihn ganz. Nur beim Start und bei der Anmeldung (D1). */
export async function lagebildAnlegen(satz: LagebildDatensatz): Promise<void> {
  try {
    await (await db()).put(STORE, satz, SCHLUESSEL);
  } catch (fehler) {
    melde('Anlegen', fehler);
  }
}

/**
 * Ändert einen BESTEHENDEN Datensatz derselben Identität, legt aber nie einen an.
 *
 * Lesen und Schreiben laufen in EINER Transaktion: zwischen beiden könnte sonst ein anderer
 * Tab löschen, und dieser schriebe den gelöschten Stand zurück — nach dem Abmelden stünde
 * wieder ein Stand auf der Platte (design.md D1, Mehrtab).
 */
async function bestehendenAendern(
  benutzerId: number,
  aendern: (alt: LagebildDatensatz) => LagebildDatensatz,
): Promise<void> {
  try {
    const tx = (await db()).transaction(STORE, 'readwrite');
    const alt = await tx.store.get(SCHLUESSEL);
    if (alt && alt.benutzer.id === benutzerId) await tx.store.put(aendern(alt), SCHLUESSEL);
    await tx.done;
  } catch (fehler) {
    melde('Schreiben', fehler);
  }
}

export function lagebildClientSchreiben(benutzerId: number, client: PersistedClient) {
  return bestehendenAendern(benutzerId, (alt) => ({ ...alt, client }));
}

export function lagebildBestaetigen(benutzerId: number, zeitpunkt: number) {
  return bestehendenAendern(benutzerId, (alt) => ({
    ...alt,
    bestaetigtAt: Math.max(alt.bestaetigtAt, zeitpunkt),
  }));
}

/** Löscht den Datensatz. Die Datenbank bleibt stehen, leer. */
export async function lagebildLoeschenPlatte(): Promise<void> {
  try {
    await (await db()).delete(STORE, SCHLUESSEL);
  } catch (fehler) {
    melde('Löschen', fehler);
  }
}
