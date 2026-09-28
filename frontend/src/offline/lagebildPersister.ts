import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core';
import { lagebildClientSchreiben, lagebildLesen, lagebildLoeschenPlatte } from './lagebildSpeicher';

/** Drosselung der Speicherung (design.md D1). Der Persister wird bei JEDER Cache-Änderung
 *  gerufen, das Dehydrieren davor läuft ungedrosselt (`persistQueryClientSave`). Gedrosselt
 *  wird der IndexedDB-Schreibvorgang samt Structured Clone — ohne ihn schriebe ein ETB mit
 *  vielen Seiten bei jedem Ereignis den ganzen Stand. */
export const LAGEBILD_DROSSEL_MS = 1_000;

export interface LagebildPersister extends Persister {
  /**
   * Beendet den Persister endgültig: ein ausstehender Durchlauf entfällt, ein laufender wird
   * abgewartet, und jeder spätere `persistClient` bleibt wirkungslos. Muss VOR dem Löschen
   * laufen — sonst schriebe der gedrosselte Durchlauf den alten Stand hinter dem Löschen
   * zurück (design.md D5).
   */
  abbrechen(): Promise<void>;
}

interface Optionen {
  drosselMs?: number;
  /** Schreibweg, im Test ersetzbar. */
  schreiben?: typeof lagebildClientSchreiben;
}

/** Persister für GENAU einen Benutzer: er stellt nur dessen Stand wieder her und schreibt nur
 *  in dessen bestehenden Datensatz. Ein Benutzerwechsel erzeugt einen neuen Persister. */
export function erzeugeLagebildPersister(
  benutzerId: number,
  { drosselMs = LAGEBILD_DROSSEL_MS, schreiben = lagebildClientSchreiben }: Optionen = {},
): LagebildPersister {
  let ausstehend: PersistedClient | null = null;
  let uhr: ReturnType<typeof setTimeout> | null = null;
  let laufend: Promise<void> = Promise.resolve();
  let tot = false;

  const durchlauf = () => {
    uhr = null;
    const client = ausstehend;
    ausstehend = null;
    if (tot || !client) return;
    laufend = laufend.then(() => schreiben(benutzerId, client));
  };

  return {
    persistClient(client) {
      if (tot) return;
      ausstehend = client;
      if (uhr === null) uhr = setTimeout(durchlauf, drosselMs);
    },
    async restoreClient() {
      const satz = await lagebildLesen();
      return satz && satz.benutzer.id === benutzerId ? satz.client : undefined;
    },
    removeClient: lagebildLoeschenPlatte,
    async abbrechen() {
      tot = true;
      ausstehend = null;
      if (uhr !== null) clearTimeout(uhr);
      uhr = null;
      await laufend;
    },
  };
}
