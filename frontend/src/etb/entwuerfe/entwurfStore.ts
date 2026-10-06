import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { istLeer, zuWerte, type EtbEntwurf } from './entwurfModell';
import { neueClientId } from '../../offline/clientId';
import {
  sicherEntfernen,
  sicherLesen,
  sicherSchluessel,
  sicherSchreiben,
} from '../../lib/sichererSpeicher';

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
 * Entfernt jeden Aktiv-Merker der Person, deren Einsatz keinen Entwurf mehr hat (LFH-941,
 * design.md D8). Ein Merker zeigt sonst je besuchtem Einsatz auf einen längst verschwundenen
 * Entwurf. Merker anderer Personen bleiben, sie gehen mit deren Abmelden.
 */
export function aktivMerkerAufraeumen(
  benutzerId: number,
  einsaetzeMitEntwurf: ReadonlySet<number>,
): void {
  const praefix = `${AKTIV_PRAEFIX}${benutzerId}-`;
  // Gesperrter Speicher liefert keine Schlüssel: dann liegt dort auch kein Merker.
  for (const k of sicherSchluessel()) {
    if (!k.startsWith(praefix)) continue;
    const einsatzId = Number(k.slice(praefix.length));
    if (!einsaetzeMitEntwurf.has(einsatzId)) sicherEntfernen(k);
  }
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
  const roh = sicherLesen(VORLAUF_PRAEFIX + id);
  try {
    const wert: unknown = roh ? JSON.parse(roh) : null;
    return wert && typeof wert === 'object' ? (wert as Vorlaufeintrag) : null;
  } catch {
    return null;
  }
}

/** Alle Entwurfs-ids mit offenem Vorlauf, gleich aus welchem Tab. */
function vorlaufIds(): string[] {
  return sicherSchluessel()
    .filter((k) => k.startsWith(VORLAUF_PRAEFIX))
    .map((k) => k.slice(VORLAUF_PRAEFIX.length));
}

/** Synchron — muss vor dem ersten `await` des Schreibauftrags stehen. */
function vormerken(id: string, entwurf: EtbEntwurf | null): string {
  const stand = neueClientId();
  // Speicher voll oder gesperrt: dann trägt allein die IndexedDB, wie vor LFH-521.
  sicherSchreiben(VORLAUF_PRAEFIX + id, JSON.stringify({ stand, entwurf }));
  return stand;
}

function quittieren(id: string, stand: string): void {
  if (vorlaufLesen(id)?.stand !== stand) return;
  sicherEntfernen(VORLAUF_PRAEFIX + id);
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

/** Ab wann ein leerer Entwurf als liegen geblieben gilt (LFH-941, design.md D8). */
const LEER_LIEGEZEIT_MS = 24 * 60 * 60 * 1000;

/**
 * Räumt die leeren Entwürfe der Person, die länger als {@link LEER_LIEGEZEIT_MS} unverändert
 * sind, über alle Einsätze, und danach die verwaisten Aktiv-Merker (LFH-941, design.md D8).
 * Seit LFH-894 sichert die Erfassung keinen leeren Entwurf mehr; liegen bleiben Altentwürfe von
 * davor und solche, die gewählte Dateien festhielten (die Dateien selbst liegen nie hier).
 * Entwürfe mit Inhalt bleiben unabhängig vom Alter (LFH-767 D4). Gelöscht wird mit derselben
 * Vorlauf-Disziplin wie {@link entwurfEntfernen} (LFH-521).
 */
async function leereAufraeumen(
  d: IDBPDatabase<EntwurfDB>,
  benutzerId: number,
  jetzt: number,
): Promise<void> {
  const grenze = jetzt - LEER_LIEGEZEIT_MS;
  const bereich = IDBKeyRange.bound([benutzerId, -Infinity], [benutzerId, Infinity]);
  const gemerkt: { id: string; stand: string }[] = [];
  const mitEntwurf = new Set<number>();
  const tx = d.transaction('entwuerfe', 'readwrite');
  let cursor = await tx.store.index('by-benutzer-einsatz').openCursor(bereich);
  while (cursor) {
    const e = cursor.value;
    const zuletzt = Date.parse(e.geaendert_at ?? e.erstellt_at);
    // Ein offener Vorlauf heißt: ein anderer Tab schreibt gerade an diesem Entwurf. Er gewinnt,
    // `vormerken(id, null)` überschriebe sonst seinen Auftrag (LFH-521).
    if (istLeer(zuWerte(e)) && zuletzt < grenze && !vorlaufLesen(e.id)) {
      gemerkt.push({ id: e.id, stand: vormerken(e.id, null) });
      await cursor.delete();
    } else {
      mitEntwurf.add(e.einsatz_id);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  for (const { id, stand } of gemerkt) quittieren(id, stand);
  aktivMerkerAufraeumen(benutzerId, mitEntwurf);
}

/** Entwürfe einer Person in einem Einsatz, aufsteigend nach erstellt_at (älteste zuerst →
 *  stabile Tab-Reihenfolge). Fremde Entwürfe liefert der Index nie (LFH-767). Vorher räumt es
 *  liegen gebliebene leere Entwürfe und verwaiste Merker der Person (LFH-941). */
export async function entwuerfeLaden(benutzerId: number, einsatzId: number): Promise<EtbEntwurf[]> {
  const d = await db();
  try {
    await vorlaufNachtragen(d);
  } catch (fehler) {
    // Ein unlesbarer Vorlauf darf die Erfassung nicht sperren; er bleibt für den nächsten Versuch.
    console.warn('ETB-Entwürfe: Vorlauf ließ sich nicht nachtragen', fehler);
  }
  try {
    await leereAufraeumen(d, benutzerId, Date.now());
  } catch (fehler) {
    // Räumen ist Pflege, kein Teil des Ladens: ein Fehler darf die Erfassung nicht sperren.
    console.warn('ETB-Entwürfe: leere Entwürfe ließen sich nicht räumen', fehler);
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
  // Gesperrter Speicher liefert keine Schlüssel: dann liegt dort auch kein Merker.
  for (const id of vorlaufIds()) sicherEntfernen(VORLAUF_PRAEFIX + id);
  for (const k of sicherSchluessel()) {
    if (k.startsWith(AKTIV_PRAEFIX)) sicherEntfernen(k);
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
  for (const id of vorlaufIds()) sicherEntfernen(VORLAUF_PRAEFIX + id);
  const d = await db();
  await d.clear('entwuerfe');
}
