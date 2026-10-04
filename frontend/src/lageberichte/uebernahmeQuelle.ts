import type { QueryClient } from '@tanstack/react-query';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import type { ModulFreigaben } from '../api/types';

/**
 * Eine Quelle für einen Abschnitt des Lagevortrags (LFH-870, Spec `lagevortrag-uebernahme`).
 * Bedienung, Rückfrage und Rechteweiche trägt `AbschnittUebernahme`; die Quelle sagt nur, ob sie
 * für die Person frei ist und welchen Text sie liefert. Zuordnung Abschnitt → Quelle:
 * `lageberichte/uebernahmen.ts`.
 */
export interface UebernahmeQuelle {
  /** Beschriftung des Knopfes, z. B. „Aus S5 übernehmen“. */
  knopf: string;
  /** Was übernommen wird, neben dem Knopf. */
  unterzeile: string;
  ersetzenTitel: string;
  ersetzenText: string;
  /** Aus den Modulfreigaben der Person. Ist nichts frei, steht statt des Knopfes der Grund. */
  verfuegbar(freigaben: ModulFreigaben): Verfuegbarkeit;
  /**
   * Lädt beim Klick und liefert den fertigen Text. Scheitert nicht an einer einzelnen Liste: was
   * fehlt, steht als „—“ mit Grund im Text (nie als 0).
   */
  erzeuge(ctx: UebernahmeKontext): Promise<string>;
}

export type Verfuegbarkeit = { frei: true } | { frei: false; grund: string };

export interface UebernahmeKontext {
  qc: QueryClient;
  einsatzId: number;
  freigaben: ModulFreigaben;
  /** ISO-Zeitpunkt → taktische DTG in der Anzeigezone. */
  dtg: (iso: string) => string;
}

/** Ergebnis eines Listenabrufs beim Klick: Zustand, Daten und Abrufzeit (ms seit Epoche). */
export interface Geladen<T> {
  zustand: AbrufZustand;
  daten: T;
  stand: number | undefined;
}

/**
 * Holt eine Liste über denselben Key wie ihre Fachseite (`fetchQuery`: gemeinsamer Cache). Ein
 * Fehler wird zum Zustand (`abrufZustand`, 403 → `gesperrt`), nie zur leeren Liste.
 */
export async function ladeListe<T>(
  qc: QueryClient,
  key: readonly unknown[],
  fn: () => Promise<T>,
  leer: T,
): Promise<Geladen<T>> {
  try {
    const daten = await qc.fetchQuery({ queryKey: key, queryFn: fn });
    return { zustand: 'daten', daten, stand: qc.getQueryState(key)?.dataUpdatedAt ?? Date.now() };
  } catch (e) {
    return {
      zustand: abrufZustand({ error: e, isError: true, isPending: false }),
      daten: leer,
      stand: undefined,
    };
  }
}

/** Eine Liste, die gar nicht erst abgerufen wird, weil ihr Modul nicht frei ist. */
export function gesperrt<T>(leer: T): Geladen<T> {
  return { zustand: 'gesperrt', daten: leer, stand: undefined };
}
