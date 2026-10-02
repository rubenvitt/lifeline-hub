import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EtbEntwurf } from './entwurfModell';
import { neueClientId } from '../../offline/clientId';

interface EntwurfDB extends DBSchema {
  entwuerfe: {
    key: string;
    value: EtbEntwurf;
    indexes: { 'by-einsatz': number };
  };
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
    dbPromise = openDB<EntwurfDB>('lifeline-etb-entwuerfe', 1, {
      upgrade(d) {
        const store = d.createObjectStore('entwuerfe', { keyPath: 'id' });
        store.createIndex('by-einsatz', 'einsatz_id');
      },
    });
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

/** Entwürfe eines Einsatzes, aufsteigend nach erstellt_at (älteste zuerst → stabile Tab-Reihenfolge). */
export async function entwuerfeLaden(einsatzId: number): Promise<EtbEntwurf[]> {
  const d = await db();
  try {
    await vorlaufNachtragen(d);
  } catch (fehler) {
    // Ein unlesbarer Vorlauf darf die Erfassung nicht sperren; er bleibt für den nächsten Versuch.
    console.warn('ETB-Entwürfe: Vorlauf ließ sich nicht nachtragen', fehler);
  }
  const alle = await d.getAllFromIndex('entwuerfe', 'by-einsatz', einsatzId);
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

/** Nur für Tests: leert den Store (fake-indexeddb persistiert sonst zwischen Tests). */
export async function entwuerfeLeerenFuerTests(): Promise<void> {
  for (const id of vorlaufIds()) localStorage.removeItem(VORLAUF_PRAEFIX + id);
  const d = await db();
  await d.clear('entwuerfe');
}
