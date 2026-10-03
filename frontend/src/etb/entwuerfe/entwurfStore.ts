import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EtbEntwurf } from './entwurfModell';
import { neueClientId } from '../../offline/clientId';

interface EntwurfDB extends DBSchema {
  entwuerfe: {
    key: string;
    value: EtbEntwurf;
    indexes: { 'by-einsatz': number; 'by-benutzer-einsatz': [number, number] };
  };
}

/** Höchstliegezeit ohne angemeldeten Besitzer (LFH-767, design.md D4). */
const HOECHSTLIEGEZEIT_OHNE_BESITZER_MS = 24 * 60 * 60 * 1000;

/** Merker des aktiven Entwurfs je Person und Einsatz (LFH-767). Der Präfix deckt auch die
 *  alten Schlüssel `etb-entwurf-aktiv-<einsatz>` ab, die beim Räumen mitgehen. */
const AKTIV_PRAEFIX = 'etb-entwurf-aktiv-';

export function aktivSchluessel(benutzerId: number, einsatzId: number): string {
  return `${AKTIV_PRAEFIX}${benutzerId}-${einsatzId}`;
}

/**
 * Vorlauf vor der IndexedDB (LFH-521): IndexedDB schreibt asynchron, und ein Neuladen oder
 * Tab-Schließen bricht eine noch offene Transaktion ab — der Entwurf wäre weg, obwohl er schon
 * im Feld stand (LFH-142 verspricht Schutz genau dort). `localStorage` schreibt synchron: jeder
 * Schreibauftrag wird hier ZUERST vermerkt, noch bevor das erste `await` fällt, und erst nach
 * dem Abschluss der Transaktion wieder gestrichen. Beim nächsten Laden trägt
 * `entwuerfeLaden` Übriggebliebenes nach. Die Persistenzgrenze liegt damit am Aufruf, nicht
 * am Ende der Transaktion.
 *
 * Je Entwurf ein eigener Schlüssel mit nur dem LETZTEN Auftrag (Fassung oder `null` = entfernen),
 * markiert mit einem `stand`: ein früher Abschluss darf einen jüngeren Auftrag nicht streichen.
 * Kein gemeinsamer Eintrag für alle Entwürfe — `localStorage` teilen sich alle Tabs, und ein Tab,
 * der eine ganze Tabelle zurückschreibt, holte einen anderswo gesendeten Entwurf zurück.
 */
const VORLAUF_PRAEFIX = 'lifeline-etb-entwuerfe-ausstehend:';

interface Vorlaufeintrag {
  stand: string;
  entwurf: EtbEntwurf | null;
}

function vorlaufLesen(id: string): Vorlaufeintrag | null {
  try {
    const roh = localStorage.getItem(VORLAUF_PRAEFIX + id);
    const wert: unknown = roh ? JSON.parse(roh) : null;
    return wert && typeof wert === 'object' ? (wert as Vorlaufeintrag) : null;
  } catch {
    return null;
  }
}

/** Alle Entwurfs-ids mit offenem Vorlauf, gleich aus welchem Tab. */
function vorlaufIds(): string[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(VORLAUF_PRAEFIX))
      .map((k) => k.slice(VORLAUF_PRAEFIX.length));
  } catch {
    return [];
  }
}

/** Synchron — muss vor dem ersten `await` des Schreibauftrags stehen. */
function vormerken(id: string, entwurf: EtbEntwurf | null): string {
  const stand = neueClientId();
  try {
    localStorage.setItem(VORLAUF_PRAEFIX + id, JSON.stringify({ stand, entwurf }));
  } catch {
    // Speicher voll oder gesperrt: dann trägt allein die IndexedDB, wie vor LFH-521.
  }
  return stand;
}

function quittieren(id: string, stand: string): void {
  if (vorlaufLesen(id)?.stand !== stand) return;
  try {
    localStorage.removeItem(VORLAUF_PRAEFIX + id);
  } catch {
    // s. vormerken
  }
}

let dbPromise: Promise<IDBPDatabase<EntwurfDB>> | null = null;

function db(): Promise<IDBPDatabase<EntwurfDB>> {
  if (!dbPromise) {
    // v2 (LFH-767): Index je Person und Einsatz. Altbestand ohne `benutzer_id` erscheint darin
    // nicht; `entwuerfeAufraeumen` übernimmt oder verwirft ihn (design.md D5).
    const geoeffnet = openDB<EntwurfDB>('lifeline-etb-entwuerfe', 2, {
      upgrade(d, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const store = d.createObjectStore('entwuerfe', { keyPath: 'id' });
          store.createIndex('by-einsatz', 'einsatz_id');
        }
        if (oldVersion < 2) {
          tx.objectStore('entwuerfe').createIndex('by-benutzer-einsatz', [
            'benutzer_id',
            'einsatz_id',
          ]);
        }
      },
      // Ein Tab mit älterem Bundle hält v1 offen und hat keinen `blocking`-Handler: dann wartet
      // dieses Upgrade, bis er schließt. Der Auth-Pfad wartet deshalb nie auf die Entwürfe
      // (LFH-767, `AuthContext.tsx`); hier wird es nur sichtbar gemacht.
      blocked() {
        console.warn('ETB-Entwürfe: ein anderer Tab hält die alte Datenbank offen');
      },
      // Ein anderer Tab mit neuerem Bundle will upgraden: Verbindung freigeben, der nächste
      // Zugriff öffnet neu. Sonst hinge dessen Upgrade, bis dieser Tab schließt.
      blocking() {
        void geoeffnet.then((d) => d.close());
        if (dbPromise === geoeffnet) dbPromise = null;
      },
    });
    dbPromise = geoeffnet;
  }
  return dbPromise;
}

/**
 * Trägt den Vorlauf in die IndexedDB nach, einsatzübergreifend und in einer Transaktion. Eine
 * jüngere Fassung auf der Platte (zweiter Tab) gewinnt gegen eine ältere aus dem Vorlauf.
 */
async function vorlaufNachtragen(d: IDBPDatabase<EntwurfDB>): Promise<void> {
  const offen = vorlaufIds().flatMap((id) => {
    const eintrag = vorlaufLesen(id);
    return eintrag ? [{ id, ...eintrag }] : [];
  });
  if (offen.length === 0) return;
  const tx = d.transaction('entwuerfe', 'readwrite');
  for (const { id, entwurf } of offen) {
    if (entwurf === null) {
      await tx.store.delete(id);
      continue;
    }
    const platte = await tx.store.get(id);
    if (!platte || platte.geaendert_at <= entwurf.geaendert_at) await tx.store.put(entwurf);
  }
  await tx.done;
  for (const { id, stand } of offen) quittieren(id, stand);
}

/** Entwürfe einer Person in einem Einsatz, aufsteigend nach erstellt_at (älteste zuerst →
 *  stabile Tab-Reihenfolge). Fremde Entwürfe liefert der Index nie (LFH-767). */
export async function entwuerfeLaden(benutzerId: number, einsatzId: number): Promise<EtbEntwurf[]> {
  const d = await db();
  try {
    await vorlaufNachtragen(d);
  } catch (fehler) {
    // Ein unlesbarer Vorlauf darf die Erfassung nicht sperren; er bleibt für den nächsten Versuch.
    console.warn('ETB-Entwürfe: Vorlauf ließ sich nicht nachtragen', fehler);
  }
  const alle = await d.getAllFromIndex('entwuerfe', 'by-benutzer-einsatz', [benutzerId, einsatzId]);
  return alle.sort((a, b) => a.erstellt_at.localeCompare(b.erstellt_at));
}

export async function entwurfSpeichern(entwurf: EtbEntwurf): Promise<void> {
  const stand = vormerken(entwurf.id, entwurf);
  const d = await db();
  await d.put('entwuerfe', entwurf);
  quittieren(entwurf.id, stand);
}

export async function entwurfEntfernen(id: string): Promise<void> {
  const stand = vormerken(id, null);
  const d = await db();
  await d.delete('entwuerfe', id);
  quittieren(id, stand);
}

/** Abmelden (LFH-767, design.md D2): alle Entwürfe samt Vorlauf und Aktiv-Merkern. Wirft bei
 *  einem Plattenfehler — `geraetRaeumen` protokolliert ihn und räumt die übrigen Orte. */
export async function entwuerfeRaeumen(): Promise<void> {
  for (const id of vorlaufIds()) localStorage.removeItem(VORLAUF_PRAEFIX + id);
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(AKTIV_PRAEFIX)) localStorage.removeItem(k);
    }
  } catch {
    // localStorage gesperrt: dann liegt dort auch kein Merker.
  }
  const d = await db();
  await d.clear('entwuerfe');
}

/**
 * Start und Anmeldung (LFH-767, design.md D4/D5). Mit bestätigter Person gehen alle fremden
 * Entwürfe, eigene bleiben unabhängig vom Alter. Ohne Person gehen nur Entwürfe, deren letzte
 * Änderung länger als 24 h zurückliegt. Altbestand ohne Besitzer übernimmt die bestätigte Person
 * einmalig, wenn er höchstens 24 h alt ist — so sah ihn vor LFH-767 ohnehin jeder Benutzer.
 *
 * Der Vorlauf wird vorher nachgetragen, damit auch ein fremder Entwurf dort erfasst wird.
 */
export async function entwuerfeAufraeumen(benutzerId: number | null, jetzt: number): Promise<void> {
  const d = await db();
  try {
    await vorlaufNachtragen(d);
  } catch (fehler) {
    // Wie in `entwuerfeLaden`: ein unlesbarer Vorlauf darf das Räumen der Platte nicht sperren.
    console.warn('ETB-Entwürfe: Vorlauf ließ sich nicht nachtragen', fehler);
  }
  const grenze = jetzt - HOECHSTLIEGEZEIT_OHNE_BESITZER_MS;
  const tx = d.transaction('entwuerfe', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    // Altbestand aus v1 trägt keinen Besitzer, obwohl der Typ ihn verlangt.
    const e = cursor.value as Omit<EtbEntwurf, 'benutzer_id'> & { benutzer_id?: number };
    const abgelaufen = Date.parse(e.geaendert_at) < grenze;
    if (e.benutzer_id === undefined) {
      if (abgelaufen) await cursor.delete();
      else if (benutzerId !== null) await cursor.update({ ...e, benutzer_id: benutzerId });
    } else if (benutzerId !== null ? e.benutzer_id !== benutzerId : abgelaufen) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Nur für Tests: leert den Store (fake-indexeddb persistiert sonst zwischen Tests). */
export async function entwuerfeLeerenFuerTests(): Promise<void> {
  for (const id of vorlaufIds()) localStorage.removeItem(VORLAUF_PRAEFIX + id);
  const d = await db();
  await d.clear('entwuerfe');
}
