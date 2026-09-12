import type { Meldung, Person } from '../api/types';
import type { PersonErfassungsSicht } from './queue';

/** Korrelation zwischen einer lokal vorgemerkten Aktion und ihrer späteren
 * Server-Antwort. Das Ereignis ist bewusst nur ein UI-Signal; die Wahrheit
 * bleibt der Query-Cache beziehungsweise der nächste API-Abruf. */
export const OFFLINE_SCHREIBAKTION_GESENDET_EVENT = 'lfh:offline-schreibaktion-gesendet';

const OFFLINE_QUITTUNG_CHANNEL = 'lfh:offline-quittungen';
const OFFLINE_QUITTUNG_STORAGE_KEY = 'lfh:offline-quittung-signal';

/** Absichtlich datenarmes Cross-Tab-Signal. Person, R-Nr., Name und client_id
 * bleiben ausschließlich in der benutzergebundenen IndexedDB-Quittung. */
export interface OfflinePersonQuittungSignal {
  typ: 'person-erfassungsquittung';
  benutzerId: number;
  einsatzId: number;
}

let quittungKanal: BroadcastChannel | null | undefined;

function holeQuittungKanal(): BroadcastChannel | null {
  if (quittungKanal !== undefined) return quittungKanal;
  if (typeof BroadcastChannel === 'undefined') {
    quittungKanal = null;
    return quittungKanal;
  }
  try {
    quittungKanal = new BroadcastChannel(OFFLINE_QUITTUNG_CHANNEL);
  } catch {
    // Restriktive Browserkontexte dürfen den bereits erfolgreichen Queue-Flush
    // nicht zurück in dessen Fehlerpfad werfen; localStorage bleibt als Fallback.
    quittungKanal = null;
  }
  return quittungKanal;
}

function istPersonQuittungSignal(wert: unknown): wert is OfflinePersonQuittungSignal {
  if (!wert || typeof wert !== 'object') return false;
  const signal = wert as Partial<OfflinePersonQuittungSignal>;
  return (
    signal.typ === 'person-erfassungsquittung' &&
    Number.isSafeInteger(signal.benutzerId) &&
    Number.isSafeInteger(signal.einsatzId)
  );
}

function meldePersonQuittungTabUebergreifend(benutzerId: number, einsatzId: number): void {
  const signal: OfflinePersonQuittungSignal = {
    typ: 'person-erfassungsquittung',
    benutzerId,
    einsatzId,
  };
  const kanal = holeQuittungKanal();
  if (kanal) {
    try {
      kanal.postMessage(signal);
      return;
    } catch {
      // Auch postMessage kann bei einem inzwischen geschlossenen/gesperrten Kanal
      // werfen. Danach einmal datenarm über den Storage-Seam signalisieren.
      try {
        kanal.close();
      } catch {
        /* bereits geschlossen */
      }
      quittungKanal = null;
    }
  }
  // `storage` erreicht wie BroadcastChannel nur andere Dokumente. Entfernen vor
  // dem Setzen sorgt dafür, dass auch zwei identische Scope-Signale nacheinander
  // ein Ereignis auslösen; der Payload bleibt trotzdem exakt datenarm.
  try {
    window.localStorage.removeItem(OFFLINE_QUITTUNG_STORAGE_KEY);
    window.localStorage.setItem(OFFLINE_QUITTUNG_STORAGE_KEY, JSON.stringify(signal));
  } catch {
    // Private-/Quota-Modi dürfen den lokalen, bereits erfolgreichen Flush nicht
    // in einen Fehler verwandeln. Der nächste Mount/visibilitychange liest IDB.
  }
}

/** Beobachtet ausschließlich datenarme Signale anderer Tabs. Der Empfänger muss
 * die benutzer-/einsatzgebundenen Details selbst aus IndexedDB lesen. */
export function beobachteOfflinePersonQuittungen(
  listener: (signal: OfflinePersonQuittungSignal) => void,
): () => void {
  const kanal = holeQuittungKanal();
  const beiKanalNachricht = (event: MessageEvent<unknown>) => {
    if (istPersonQuittungSignal(event.data)) listener(event.data);
  };
  const beiStorage = (event: StorageEvent) => {
    if (event.key !== OFFLINE_QUITTUNG_STORAGE_KEY || event.newValue == null) return;
    try {
      const signal: unknown = JSON.parse(event.newValue);
      if (istPersonQuittungSignal(signal)) listener(signal);
    } catch {
      // Fremde/defekte localStorage-Werte werden ignoriert.
    }
  };
  if (kanal) kanal.addEventListener('message', beiKanalNachricht);
  // Immer mithören: ein zunächst funktionierender Kanal kann beim späteren
  // postMessage ausfallen; der Sender wechselt dann ohne Neu-Mount auf Storage.
  window.addEventListener('storage', beiStorage);
  return () => {
    if (kanal) kanal.removeEventListener('message', beiKanalNachricht);
    window.removeEventListener('storage', beiStorage);
  };
}

/** Test-Seam, damit ein Mock-Kanal nicht zwischen Vitest-Fällen weiterlebt. */
export function offlineQuittungsKanalZuruecksetzenFuerTests(): void {
  quittungKanal?.close();
  quittungKanal = undefined;
}

export type OfflineSchreibaktionGesendet =
  | {
      art: 'person';
      benutzerId: number;
      einsatzId: number;
      clientId: string;
      daten: Person;
      sicht: PersonErfassungsSicht;
    }
  | {
      art: 'meldung';
      benutzerId: number;
      einsatzId: number;
      clientId: string;
      daten: Meldung;
    };

export function meldeOfflineSchreibaktionGesendet(detail: OfflineSchreibaktionGesendet): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OfflineSchreibaktionGesendet>(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, { detail }),
  );
  if (detail.art === 'person') {
    meldePersonQuittungTabUebergreifend(detail.benutzerId, detail.einsatzId);
  }
}
