import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { NeuerEintrag } from '../api/etb';
import type { PersonAnlegenEingabe } from '../api/einsatzPerson';
import type {
  AusgabeEingabe,
  BelegungsmeldungEingabe,
  NeueMeldung,
  Person,
  StandmeldungEingabe,
} from '../api/types';

/** Ein Ereignis genügt allen React-Verbrauchern zum erneuten Lesen der
 * IndexedDB-Zähler. IndexedDB selbst ist nicht beobachtbar. */
export const OFFLINE_QUEUE_EVENT = 'lfh:offline-queue-geaendert';

/**
 * Stand- und Belegungsmeldungen und Verpflegungsausgaben tragen zusätzlich die `bezeichnung`
 * (Bezirk, Stelle bzw. Zeitfenster) — nur für die Anzeige, gesendet wird sie nicht. Neue
 * Varianten liegen als Wert im bestehenden Store und brauchen keine DB-Version.
 */
export type OfflineSchreibaktion =
  | { art: 'person'; daten: PersonAnlegenEingabe }
  | { art: 'meldung'; daten: NeueMeldung }
  | { art: 'stand'; bezirk_id: number; bezeichnung: string; daten: StandmeldungEingabe }
  | { art: 'belegung'; stelle_id: number; bezeichnung: string; daten: BelegungsmeldungEingabe }
  | { art: 'ausgabe'; zeitfenster_id: number; bezeichnung: string; daten: AusgabeEingabe };

export interface AusstehendeSchreibaktion {
  id?: number;
  /** `benutzer.id` ist datenbankweit eindeutig; dadurch genügt diese eine
   * Identität zur sicheren Trennung auch über Organisationsgrenzen hinweg. */
  benutzer_id: number;
  einsatz_id: number;
  aktion: OfflineSchreibaktion;
  erstellt_at: string;
}

export interface AbgelehnteSchreibaktion extends AusstehendeSchreibaktion {
  grund: string;
  abgelehnt_at: string;
}

export type PersonErfassungsSicht = Extract<Person['status'], 'erfasst' | 'vermisst' | 'betroffen'>;

/** Dauerhafte Erfolgsquittung einer offline vorgemerkten Person. Sie wird erst
 * nach erfolgreichem Server-Replay zusammen mit dem Entfernen der Pending-Zeile
 * geschrieben und bleibt bis zur Darstellung auf der Personen-Seite erhalten. */
interface PersonErfassungsQuittung {
  benutzer_id: number;
  einsatz_id: number;
  client_id: string;
  person: Person;
  sicht: PersonErfassungsSicht;
  erstellt_at: string;
}

export interface OfflineQueueZaehler {
  ausstehend: number;
  abgelehnt: number;
  /** Vor v4 erfasste, keinem Benutzer sicher zuordenbare Zeilen. */
  nicht_zugeordnet: number;
}

export interface AusstehenderEintrag {
  id?: number;
  /** Globale Benutzer-ID desjenigen, der den Offline-Eintrag erfasst hat. */
  benutzer_id: number;
  einsatz_id: number;
  eintrag: NeuerEintrag;
  erstellt_at: string;
}

/**
 * Endgültig fachlich abgelehnter Offline-Eintrag. Persistent (eigener Store), damit der
 * Verlust nach einem Reload sichtbar bleibt, statt in flüchtigem React-State zu verschwinden.
 */
export interface AbgelehnterEintrag extends AusstehenderEintrag {
  grund: string;
  abgelehnt_at: string;
}

interface OfflineDB extends DBSchema {
  ausstehend: {
    key: number;
    value: AusstehenderEintrag;
    indexes: {
      'by-einsatz': number;
      'by-benutzer': number;
      'by-benutzer-einsatz': [number, number];
    };
  };
  abgelehnt: {
    key: number;
    value: AbgelehnterEintrag;
    indexes: {
      'by-einsatz': number;
      'by-benutzer': number;
      'by-benutzer-einsatz': [number, number];
    };
  };
  schreibaktionen: {
    key: number;
    value: AusstehendeSchreibaktion;
    indexes: {
      'by-einsatz': number;
      'by-benutzer': number;
      'by-benutzer-einsatz': [number, number];
    };
  };
  schreibaktionenAbgelehnt: {
    key: number;
    value: AbgelehnteSchreibaktion;
    indexes: {
      'by-einsatz': number;
      'by-benutzer': number;
      'by-benutzer-einsatz': [number, number];
    };
  };
  personErfassungsQuittungen: {
    key: [number, number, string];
    value: PersonErfassungsQuittung;
    indexes: {
      'by-benutzer': number;
      'by-benutzer-einsatz': [number, number];
    };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function db(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    // v2: `abgelehnt`-Store. v3: Personen-/Meldungs-Schreibaktionen; die ETB-Stores bleiben
    // byte-kompatibel. v4 bindet alle Stores an die Benutzer-ID; Legacy-Zeilen ohne `benutzer_id`
    // erscheinen in keinem Index und werden nie automatisch unter einer späteren Sitzung versendet.
    // v5: Personen-Erfolgsquittungen. Jeder Store wird versionsgeguardet angelegt, sonst würfe
    // `createObjectStore` auf einer Bestands-DB.
    dbPromise = openDB<OfflineDB>('lifeline-offline', 5, {
      upgrade(d, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const store = d.createObjectStore('ausstehend', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-einsatz', 'einsatz_id');
        }
        if (oldVersion < 2) {
          const store = d.createObjectStore('abgelehnt', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-einsatz', 'einsatz_id');
        }
        if (oldVersion < 3) {
          const aktionen = d.createObjectStore('schreibaktionen', {
            keyPath: 'id',
            autoIncrement: true,
          });
          aktionen.createIndex('by-einsatz', 'einsatz_id');
          const abgelehnteAktionen = d.createObjectStore('schreibaktionenAbgelehnt', {
            keyPath: 'id',
            autoIncrement: true,
          });
          abgelehnteAktionen.createIndex('by-einsatz', 'einsatz_id');
        }
        if (oldVersion < 4) {
          tx.objectStore('ausstehend').createIndex('by-benutzer', 'benutzer_id');
          tx.objectStore('ausstehend').createIndex('by-benutzer-einsatz', [
            'benutzer_id',
            'einsatz_id',
          ]);
          tx.objectStore('abgelehnt').createIndex('by-benutzer', 'benutzer_id');
          tx.objectStore('abgelehnt').createIndex('by-benutzer-einsatz', [
            'benutzer_id',
            'einsatz_id',
          ]);
          tx.objectStore('schreibaktionen').createIndex('by-benutzer', 'benutzer_id');
          tx.objectStore('schreibaktionen').createIndex('by-benutzer-einsatz', [
            'benutzer_id',
            'einsatz_id',
          ]);
          tx.objectStore('schreibaktionenAbgelehnt').createIndex('by-benutzer', 'benutzer_id');
          tx.objectStore('schreibaktionenAbgelehnt').createIndex('by-benutzer-einsatz', [
            'benutzer_id',
            'einsatz_id',
          ]);
        }
        if (oldVersion < 5) {
          const quittungen = d.createObjectStore('personErfassungsQuittungen', {
            keyPath: ['benutzer_id', 'einsatz_id', 'client_id'],
          });
          quittungen.createIndex('by-benutzer', 'benutzer_id');
          quittungen.createIndex('by-benutzer-einsatz', ['benutzer_id', 'einsatz_id']);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Tabübergreifendes, datenloses Signal „die Queue hat sich geändert“ (LFH-688). Das Fenster-
 * Ereignis erreicht nur den eigenen Tab; flusht ein anderer Tab desselben Geräts, bliebe eine
 * vorgemerkte Ausgabe hier sonst als „ausstehend“ neben ihrer bestätigten Fassung stehen.
 * Bewusst NICHT als Fenster-Ereignis weitergereicht: der Flush (`useOfflineSync`) hört auf
 * `OFFLINE_QUEUE_EVENT` und soll nicht von jeder Änderung eines anderen Tabs angestoßen werden.
 */
export const QUEUE_KANAL = 'lfh:offline-queue';

let queueKanal: BroadcastChannel | null | undefined;

function holeQueueKanal(): BroadcastChannel | null {
  if (queueKanal !== undefined) return queueKanal;
  if (typeof BroadcastChannel === 'undefined') {
    queueKanal = null;
    return queueKanal;
  }
  try {
    queueKanal = new BroadcastChannel(QUEUE_KANAL);
  } catch {
    // Restriktive Browserkontexte: dann gilt nur das Fenster-Ereignis des eigenen Tabs.
    queueKanal = null;
  }
  return queueKanal;
}

function meldeQueueAenderung(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
  try {
    holeQueueKanal()?.postMessage({ typ: 'queue-geaendert' });
  } catch {
    // Ein geschlossener Kanal darf den schon geschriebenen Queue-Stand nicht in einen Fehler
    // verwandeln; der nächste Mount liest IndexedDB ohnehin neu.
  }
}

/** Hört auf Queue-Änderungen dieses Tabs (Fenster-Ereignis) UND anderer Tabs (Kanal). */
export function beobachteQueueAenderungen(listener: () => void): () => void {
  const kanal = holeQueueKanal();
  window.addEventListener(OFFLINE_QUEUE_EVENT, listener);
  kanal?.addEventListener('message', listener);
  return () => {
    window.removeEventListener(OFFLINE_QUEUE_EVENT, listener);
    kanal?.removeEventListener('message', listener);
  };
}

/** Test-Seam, damit ein Kanal nicht zwischen Vitest-Fällen weiterlebt. */
export function queueKanalZuruecksetzenFuerTests(): void {
  queueKanal?.close();
  queueKanal = undefined;
}

const benutzerEinsatz = (benutzerId: number, einsatzId: number): [number, number] => [
  benutzerId,
  einsatzId,
];

export async function queueEinreihen(
  benutzerId: number,
  einsatzId: number,
  eintrag: NeuerEintrag,
): Promise<void> {
  const d = await db();
  // Idempotenzschlüssel: der Hook mintet ihn schon beim Online-Versuch, damit online und Flush
  // dieselbe Id tragen; hier nur Fallback, ein vorhandener wird NIE überschrieben.
  const mitId: NeuerEintrag = {
    ...eintrag,
    client_id: eintrag.client_id ?? crypto.randomUUID(),
  };
  await d.add('ausstehend', {
    benutzer_id: benutzerId,
    einsatz_id: einsatzId,
    eintrag: mitId,
    erstellt_at: new Date().toISOString(),
  });
  meldeQueueAenderung();
}

/** Ausstehende Einträge eines Einsatzes in Einreihungs-Reihenfolge (aufsteigende id). */
export async function queueLaden(
  benutzerId: number,
  einsatzId: number,
): Promise<AusstehenderEintrag[]> {
  const d = await db();
  const alle = await d.getAllFromIndex(
    'ausstehend',
    'by-benutzer-einsatz',
    benutzerEinsatz(benutzerId, einsatzId),
  );
  return alle.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function queueEntfernen(benutzerId: number, id: number): Promise<boolean> {
  const d = await db();
  const tx = d.transaction('ausstehend', 'readwrite');
  const eintrag = await tx.store.get(id);
  const geloescht = eintrag?.benutzer_id === benutzerId;
  if (geloescht) await tx.store.delete(id);
  await tx.done;
  if (geloescht) meldeQueueAenderung();
  return geloescht;
}

/** Verschiebt einen fachlich abgelehnten ETB-Eintrag atomar in den
 * Ablehnungs-Store. Add und Delete committen gemeinsam oder gar nicht. */
export async function queueAblehnen(
  benutzerId: number,
  eintrag: AusstehenderEintrag,
  grund: string,
): Promise<boolean> {
  if (eintrag.id == null || eintrag.benutzer_id !== benutzerId) return false;
  const d = await db();
  const tx = d.transaction(['ausstehend', 'abgelehnt'], 'readwrite');
  const aktuell = await tx.objectStore('ausstehend').get(eintrag.id);
  if (!aktuell || aktuell.benutzer_id !== benutzerId) {
    await tx.done;
    return false;
  }
  const { id, ...ohneId } = aktuell;
  void id;
  await tx.objectStore('abgelehnt').add({
    ...ohneId,
    grund,
    abgelehnt_at: new Date().toISOString(),
  });
  await tx.objectStore('ausstehend').delete(eintrag.id);
  await tx.done;
  meldeQueueAenderung();
  return true;
}

/** Abgelehnte Einträge eines Einsatzes in Reihenfolge (aufsteigende id). */
export async function abgelehntLaden(
  benutzerId: number,
  einsatzId?: number,
): Promise<AbgelehnterEintrag[]> {
  const d = await db();
  const alle =
    einsatzId == null
      ? await d.getAllFromIndex('abgelehnt', 'by-benutzer', benutzerId)
      : await d.getAllFromIndex(
          'abgelehnt',
          'by-benutzer-einsatz',
          benutzerEinsatz(benutzerId, einsatzId),
        );
  return alle.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function abgelehntEntfernen(benutzerId: number, id: number): Promise<boolean> {
  const d = await db();
  const tx = d.transaction('abgelehnt', 'readwrite');
  const eintrag = await tx.store.get(id);
  const geloescht = eintrag?.benutzer_id === benutzerId;
  if (geloescht) await tx.store.delete(id);
  await tx.done;
  if (geloescht) meldeQueueAenderung();
  return geloescht;
}

/** Legt einen bewusst erneut versuchten ETB-Eintrag atomar zurück in die Pending-Queue. */
export function abgelehntWiederholen(benutzerId: number, id: number): Promise<boolean> {
  return abgelehntZurueckreihen(benutzerId, id, (eintrag) => eintrag);
}

/**
 * Wie {@link abgelehntWiederholen}, aber ohne `anhang_ids` (LFH-746). Lag der Eintrag länger
 * als die Karenz des Verwaisten-Sweeps in der Queue, sind seine Dateien weg, und jeder Versuch
 * mit ihnen endet wieder in 400. Die `client_id` bleibt: Die 400 hat nichts committet.
 */
export function abgelehntOhneAnhaengeWiederholen(benutzerId: number, id: number): Promise<boolean> {
  return abgelehntZurueckreihen(benutzerId, id, ({ anhang_ids, ...ohneAnhaenge }) => {
    void anhang_ids;
    return ohneAnhaenge;
  });
}

async function abgelehntZurueckreihen(
  benutzerId: number,
  id: number,
  anpassen: (eintrag: NeuerEintrag) => NeuerEintrag,
): Promise<boolean> {
  const d = await db();
  const tx = d.transaction(['abgelehnt', 'ausstehend'], 'readwrite');
  const abgelehnt = await tx.objectStore('abgelehnt').get(id);
  if (!abgelehnt || abgelehnt.benutzer_id !== benutzerId) {
    await tx.done;
    return false;
  }
  await tx.objectStore('ausstehend').add({
    benutzer_id: abgelehnt.benutzer_id,
    einsatz_id: abgelehnt.einsatz_id,
    eintrag: anpassen(abgelehnt.eintrag),
    erstellt_at: abgelehnt.erstellt_at,
  });
  await tx.objectStore('abgelehnt').delete(id);
  await tx.done;
  meldeQueueAenderung();
  return true;
}

/** Alle ausstehenden ETB-Einträge, einsatzübergreifend. Für den globalen Flush. */
export async function queueAlleLaden(benutzerId: number): Promise<AusstehenderEintrag[]> {
  const d = await db();
  return (await d.getAllFromIndex('ausstehend', 'by-benutzer', benutzerId)).sort(
    (a, b) => a.erstellt_at.localeCompare(b.erstellt_at) || (a.id ?? 0) - (b.id ?? 0),
  );
}

export async function schreibaktionEinreihen(
  benutzerId: number,
  einsatzId: number,
  aktion: OfflineSchreibaktion,
): Promise<void> {
  const d = await db();
  await d.add('schreibaktionen', {
    benutzer_id: benutzerId,
    einsatz_id: einsatzId,
    aktion,
    erstellt_at: new Date().toISOString(),
  });
  meldeQueueAenderung();
}

export async function schreibaktionenLaden(
  benutzerId: number,
  einsatzId?: number,
): Promise<AusstehendeSchreibaktion[]> {
  const d = await db();
  const alle =
    einsatzId == null
      ? await d.getAllFromIndex('schreibaktionen', 'by-benutzer', benutzerId)
      : await d.getAllFromIndex(
          'schreibaktionen',
          'by-benutzer-einsatz',
          benutzerEinsatz(benutzerId, einsatzId),
        );
  return alle.sort(
    (a, b) => a.erstellt_at.localeCompare(b.erstellt_at) || (a.id ?? 0) - (b.id ?? 0),
  );
}

export async function schreibaktionEntfernen(benutzerId: number, id: number): Promise<boolean> {
  const d = await db();
  const tx = d.transaction('schreibaktionen', 'readwrite');
  const eintrag = await tx.store.get(id);
  const geloescht = eintrag?.benutzer_id === benutzerId;
  if (geloescht) await tx.store.delete(id);
  await tx.done;
  if (geloescht) meldeQueueAenderung();
  return geloescht;
}

/** Schließt genau eine erfolgreich replayte Personen-Aktion ab. Erfolgsquittung
 * und Entfernen aus der Pending-Queue liegen in derselben IndexedDB-Transaktion:
 * Ein Reload sieht daher entweder weiterhin die sendbare Aktion oder sicher die
 * anzuzeigende Registrierquittung, nie eine Lücke dazwischen. */
export async function schreibaktionPersonAbschliessen(
  benutzerId: number,
  eintrag: AusstehendeSchreibaktion,
  person: Person,
): Promise<PersonErfassungsQuittung | null> {
  if (eintrag.id == null || eintrag.benutzer_id !== benutzerId || eintrag.aktion.art !== 'person')
    return null;

  const d = await db();
  const tx = d.transaction(['schreibaktionen', 'personErfassungsQuittungen'], 'readwrite');
  const aktuell = await tx.objectStore('schreibaktionen').get(eintrag.id);
  if (!aktuell || aktuell.benutzer_id !== benutzerId || aktuell.aktion.art !== 'person') {
    await tx.done;
    return null;
  }

  // Aktuelle Einreihungen besitzen immer eine client_id. Der deterministische
  // Fallback hält jedoch auch eine bereits existierende Alt-Zeile verlustfrei,
  // statt sie nach erfolgreicher Server-Antwort in einer Replay-Schleife zu lassen.
  const clientId =
    aktuell.aktion.daten.client_id ?? `legacy-person-${aktuell.id ?? eintrag.id}-${person.id}`;
  const quittung: PersonErfassungsQuittung = {
    benutzer_id: benutzerId,
    einsatz_id: aktuell.einsatz_id,
    client_id: clientId,
    person,
    sicht: aktuell.aktion.daten.status ?? 'erfasst',
    erstellt_at: new Date().toISOString(),
  };
  await tx.objectStore('personErfassungsQuittungen').put(quittung);
  await tx.objectStore('schreibaktionen').delete(eintrag.id);
  await tx.done;
  meldeQueueAenderung();
  return quittung;
}

/** Ungelesene Personen-Erfolgsquittungen ausschließlich für die angegebene
 * Benutzer-/Einsatz-Kombination, in Abschlussreihenfolge. */
export async function personErfassungsQuittungenLaden(
  benutzerId: number,
  einsatzId: number,
): Promise<PersonErfassungsQuittung[]> {
  const d = await db();
  const alle = await d.getAllFromIndex(
    'personErfassungsQuittungen',
    'by-benutzer-einsatz',
    benutzerEinsatz(benutzerId, einsatzId),
  );
  return alle.sort(
    (a, b) => a.erstellt_at.localeCompare(b.erstellt_at) || a.client_id.localeCompare(b.client_id),
  );
}

/** Quittiert eine bereits in der Personen-UI dargestellte Erfolgsquittung.
 * Der zusammengesetzte Schlüssel verhindert Löschen über Benutzer- oder
 * Einsatzgrenzen hinweg. */
export async function personErfassungsQuittungEntfernen(
  benutzerId: number,
  einsatzId: number,
  clientId: string,
): Promise<boolean> {
  const d = await db();
  const schluessel: [number, number, string] = [benutzerId, einsatzId, clientId];
  const tx = d.transaction('personErfassungsQuittungen', 'readwrite');
  const vorhanden = await tx.store.get(schluessel);
  const geloescht = vorhanden != null;
  if (geloescht) await tx.store.delete(schluessel);
  await tx.done;
  return geloescht;
}

export async function schreibaktionAblehnen(
  benutzerId: number,
  eintrag: AusstehendeSchreibaktion,
  grund: string,
): Promise<boolean> {
  if (eintrag.id == null || eintrag.benutzer_id !== benutzerId) return false;
  const d = await db();
  const tx = d.transaction(['schreibaktionen', 'schreibaktionenAbgelehnt'], 'readwrite');
  const aktuell = await tx.objectStore('schreibaktionen').get(eintrag.id);
  if (!aktuell || aktuell.benutzer_id !== benutzerId) {
    await tx.done;
    return false;
  }
  const { id, ...ohneId } = aktuell;
  void id;
  await tx.objectStore('schreibaktionenAbgelehnt').add({
    ...ohneId,
    grund,
    abgelehnt_at: new Date().toISOString(),
  });
  await tx.objectStore('schreibaktionen').delete(eintrag.id);
  await tx.done;
  meldeQueueAenderung();
  return true;
}

export async function schreibaktionenAbgelehntLaden(
  benutzerId: number,
  einsatzId?: number,
): Promise<AbgelehnteSchreibaktion[]> {
  const d = await db();
  const alle =
    einsatzId == null
      ? await d.getAllFromIndex('schreibaktionenAbgelehnt', 'by-benutzer', benutzerId)
      : await d.getAllFromIndex(
          'schreibaktionenAbgelehnt',
          'by-benutzer-einsatz',
          benutzerEinsatz(benutzerId, einsatzId),
        );
  return alle.sort(
    (a, b) => a.abgelehnt_at.localeCompare(b.abgelehnt_at) || (a.id ?? 0) - (b.id ?? 0),
  );
}

export async function schreibaktionAbgelehntVerwerfen(
  benutzerId: number,
  id: number,
): Promise<boolean> {
  const d = await db();
  const tx = d.transaction('schreibaktionenAbgelehnt', 'readwrite');
  const eintrag = await tx.store.get(id);
  const geloescht = eintrag?.benutzer_id === benutzerId;
  if (geloescht) await tx.store.delete(id);
  await tx.done;
  if (geloescht) meldeQueueAenderung();
  return geloescht;
}

/** Legt eine bewusst erneut versuchte Fachaktion atomar zurück in die Pending-Queue. */
export async function schreibaktionAbgelehntWiederholen(
  benutzerId: number,
  id: number,
): Promise<boolean> {
  const d = await db();
  const tx = d.transaction(['schreibaktionenAbgelehnt', 'schreibaktionen'], 'readwrite');
  const abgelehnt = await tx.objectStore('schreibaktionenAbgelehnt').get(id);
  if (!abgelehnt || abgelehnt.benutzer_id !== benutzerId) {
    await tx.done;
    return false;
  }
  await tx.objectStore('schreibaktionen').add({
    benutzer_id: abgelehnt.benutzer_id,
    einsatz_id: abgelehnt.einsatz_id,
    aktion: abgelehnt.aktion,
    erstellt_at: abgelehnt.erstellt_at,
  });
  await tx.objectStore('schreibaktionenAbgelehnt').delete(id);
  await tx.done;
  meldeQueueAenderung();
  return true;
}

function ohneBenutzerbindung(eintrag: { benutzer_id: number }): boolean {
  // Vor v4 fehlt das Feld zur Laufzeit, auch wenn die aktuelle DB-Typdefinition
  // es für neu geschriebene Zeilen verpflichtend macht.
  return (eintrag as { benutzer_id?: number }).benutzer_id == null;
}

const OFFLINE_STORE_NAMEN = [
  'ausstehend',
  'abgelehnt',
  'schreibaktionen',
  'schreibaktionenAbgelehnt',
] as const;

/** Liefert ausschließlich eine globale Anzahl der v1-v3-Zeilen ohne sichere
 * Benutzerbindung. Weder Payload, Einsatz, Art noch Zeitstempel verlassen die
 * Queue-Schicht; eine spätere Sitzung darf daraus keine fremden Rohdaten lernen. */
export async function queueNichtZugeordnetZaehlen(): Promise<number> {
  const d = await db();
  const [etbOffen, etbAbgelehnt, aktionenOffen, aktionenAbgelehnt] = await Promise.all([
    d.getAll('ausstehend'),
    d.getAll('abgelehnt'),
    d.getAll('schreibaktionen'),
    d.getAll('schreibaktionenAbgelehnt'),
  ]);
  return [...etbOffen, ...etbAbgelehnt, ...aktionenOffen, ...aktionenAbgelehnt].filter(
    ohneBenutzerbindung,
  ).length;
}

/** Verwirft alle nicht attribuierbaren Alt-Daten in einer Transaktion. Eine
 * Übernahme in die aktuelle Sitzung ist absichtlich unmöglich. Zeilen mit bekannter
 * Benutzer-ID bleiben selbst bei einem gleichzeitig geöffneten fremden Tab erhalten. */
export async function queueNichtZugeordnetAlleVerwerfen(): Promise<number> {
  const d = await db();
  const tx = d.transaction(OFFLINE_STORE_NAMEN, 'readwrite');
  let geloescht = 0;
  for (const storeName of OFFLINE_STORE_NAMEN) {
    const store = tx.objectStore(storeName);
    let cursor = await store.openCursor();
    while (cursor) {
      if (ohneBenutzerbindung(cursor.value)) {
        await cursor.delete();
        geloescht += 1;
      }
      cursor = await cursor.continue();
    }
  }
  await tx.done;
  if (geloescht > 0) meldeQueueAenderung();
  return geloescht;
}

export async function queueZaehlerLaden(
  benutzerId: number,
  einsatzId?: number,
): Promise<OfflineQueueZaehler> {
  const d = await db();
  const [etbOffen, etbAbgelehnt, aktionenOffen, aktionenAbgelehnt] =
    einsatzId == null
      ? await Promise.all([
          d.getAllKeysFromIndex('ausstehend', 'by-benutzer', benutzerId),
          d.getAllKeysFromIndex('abgelehnt', 'by-benutzer', benutzerId),
          d.getAllKeysFromIndex('schreibaktionen', 'by-benutzer', benutzerId),
          d.getAllKeysFromIndex('schreibaktionenAbgelehnt', 'by-benutzer', benutzerId),
        ])
      : await Promise.all([
          d.getAllKeysFromIndex(
            'ausstehend',
            'by-benutzer-einsatz',
            benutzerEinsatz(benutzerId, einsatzId),
          ),
          d.getAllKeysFromIndex(
            'abgelehnt',
            'by-benutzer-einsatz',
            benutzerEinsatz(benutzerId, einsatzId),
          ),
          d.getAllKeysFromIndex(
            'schreibaktionen',
            'by-benutzer-einsatz',
            benutzerEinsatz(benutzerId, einsatzId),
          ),
          d.getAllKeysFromIndex(
            'schreibaktionenAbgelehnt',
            'by-benutzer-einsatz',
            benutzerEinsatz(benutzerId, einsatzId),
          ),
        ]);
  // Der Legacy-Zähler ist absichtlich global. Eine einsatzbezogene Anzahl würde
  // bereits Metadaten einer nicht attribuierbaren früheren Sitzung offenlegen.
  const nichtZugeordnet = await queueNichtZugeordnetZaehlen();
  return {
    ausstehend: etbOffen.length + aktionenOffen.length,
    abgelehnt: etbAbgelehnt.length + aktionenAbgelehnt.length,
    nicht_zugeordnet: nichtZugeordnet,
  };
}

/** Nur für Tests: leert beide Stores (gleiche Verbindung, kein Reconnect nötig). */
export async function queueLeerenFuerTests(): Promise<void> {
  const d = await db();
  await d.clear('ausstehend');
  await d.clear('abgelehnt');
  await d.clear('schreibaktionen');
  await d.clear('schreibaktionenAbgelehnt');
  await d.clear('personErfassungsQuittungen');
  meldeQueueAenderung();
}

/** Nur für Migrationstests: simuliert eine v3-Zeile ohne Benutzerbindung.
 * Solche Legacy-Zeilen bleiben persistent, sind aber über keinen v4-Benutzerindex erreichbar. */
export async function queueLegacyEinreihenFuerTests(
  einsatzId: number,
  eintrag: NeuerEintrag,
): Promise<void> {
  const d = await db();
  await d.add('ausstehend', {
    einsatz_id: einsatzId,
    eintrag,
    erstellt_at: new Date().toISOString(),
  } as unknown as AusstehenderEintrag);
  meldeQueueAenderung();
}
