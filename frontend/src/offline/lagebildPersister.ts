import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core';
import { lagebildClientSchreiben, lagebildLesen, lagebildLoeschenPlatte } from './lagebildSpeicher';

/**
 * Drosselung der Speicherung (design.md D1, LFH-939 D1). Gedrosselt wird schon das
 * Dehydrieren: Der Persister bekommt bei jedem Cache-Ereignis nur einen Erzeuger
 * ({@link LagebildPersister.vormerken}) und ruft ihn erst, wenn er wirklich schreibt. Sonst liefe
 * bei Ereignissen im Sekundentakt (Fahrzeugstatus, Live-Kanal) je Ereignis ein voller
 * Structured Clone auf dem Main-Thread.
 */
export const LAGEBILD_DROSSEL_MS = 1_000;

export interface LagebildPersister extends Persister {
  /**
   * Merkt einen Stand vor, ohne ihn schon zu erzeugen. Single-Flight (LFH-939 D1): Läuft ein
   * Schreibvorgang, ersetzt ein neuer Erzeuger nur den wartenden; nach dem Ende folgt nach der
   * Drossel genau ein weiterer Durchlauf mit dem jüngsten. Es wartet also höchstens ein
   * Erzeuger, nie ein fertiger Stand, und keine Kette wächst.
   */
  vormerken(erzeuge: () => PersistedClient): void;
  /**
   * Beendet den Persister endgültig: ein ausstehender Durchlauf entfällt, ein laufender wird
   * abgewartet, und jeder spätere Aufruf bleibt wirkungslos. Muss VOR dem Löschen laufen —
   * sonst schriebe der gedrosselte Durchlauf den alten Stand hinter dem Löschen zurück
   * (design.md D5).
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
  let wartend: (() => PersistedClient) | null = null;
  let uhr: ReturnType<typeof setTimeout> | null = null;
  let laufend: Promise<void> | null = null;
  let tot = false;

  const planen = () => {
    if (uhr === null && laufend === null && wartend !== null && !tot) {
      uhr = setTimeout(durchlauf, drosselMs);
    }
  };

  const durchlauf = () => {
    uhr = null;
    const erzeuge = wartend;
    wartend = null;
    if (tot || !erzeuge) return;
    let client: PersistedClient;
    try {
      client = erzeuge();
    } catch (fehler) {
      console.warn('Lagebild: Stand ließ sich nicht erzeugen', fehler);
      return;
    }
    laufend = Promise.resolve()
      .then(() => schreiben(benutzerId, client))
      .catch((fehler: unknown) => console.warn('Lagebild: Schreiben fehlgeschlagen', fehler))
      .finally(() => {
        laufend = null;
        planen();
      });
  };

  const vormerken = (erzeuge: () => PersistedClient) => {
    if (tot) return;
    wartend = erzeuge;
    planen();
  };

  return {
    vormerken,
    persistClient(client) {
      vormerken(() => client);
    },
    // Vom Start nicht genutzt: er stellt selbst wieder her, weil unmittelbar vor `hydrate`
    // gefiltert werden muss (`wiederherstellen` in `lagebildSitzung.ts`, Review Befund 2).
    // Das `Persister`-Interface verlangt die Methode; sie bleibt identitätsgebunden richtig.
    async restoreClient() {
      const satz = await lagebildLesen();
      return satz && satz.benutzer.id === benutzerId ? satz.client : undefined;
    },
    removeClient: lagebildLoeschenPlatte,
    async abbrechen() {
      tot = true;
      wartend = null;
      if (uhr !== null) clearTimeout(uhr);
      uhr = null;
      await laufend;
    },
  };
}
