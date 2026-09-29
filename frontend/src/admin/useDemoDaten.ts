import { useQuery, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ladeDemoDatenStatus } from '../api/demoDaten';
import { globalKeys, istKeyDesEinsatzes } from '../api/queryKeys';
import type { DemoDatenStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { istAdmin } from '../einsatz/schreibrecht';

/**
 * Stand der Demo-Daten für die Oberfläche.
 *
 * EINE Quelle für Verwaltungsmenü, Sektion und Einsatzliste: `GET /api/demo-daten`. 404 heißt
 * „nicht freigeschaltet“ (ohne `--demo-daten` sind die Routen nicht registriert), 200 liefert
 * den Status.
 *
 * Abgefragt wird NUR für den System-Admin (`enabled`). `retry: false`, damit ein 404 kein
 * Fehlerbild und keine Wiederholungen auslöst — unabhängig von der Client-Vorgabe.
 * Nicht in `api/`: der Response-Typen-Guard verlangt dort für jeden exportierten Objekt-Typ ein
 * generiertes Gegenstück, und {@link DemoDatenStand} ist eine reine Oberflächenform.
 */
export interface DemoDatenStand {
  /** Status 200 für einen System-Admin. Nur dann gibt es Menüeintrag, Sektion und Hinweis. */
  freigeschaltet: boolean;
  /** Status 404: nicht freigeschaltet. Die Route leitet weg; das ist KEIN Fehler. */
  abgeschaltet: boolean;
  /** Der Status, solange {@link freigeschaltet} gilt. */
  status: DemoDatenStatus | undefined;
  /** Die erste Abfrage läuft noch (für Nicht-Admins immer `false`). */
  laedt: boolean;
  /** Jeder andere Fehler als 404 (Netz, 500, 403), sonst `null`. */
  fehler: unknown;
  neuLaden: () => void;
}

export function useDemoDatenStatus(): DemoDatenStand {
  const { benutzer } = useAuth();
  const aktiv = istAdmin(benutzer);
  const abfrage = useQuery({
    queryKey: globalKeys.demoDaten(),
    queryFn: ladeDemoDatenStatus,
    enabled: aktiv,
    retry: false,
  });
  const abgeschaltet = aktiv && abfrage.error instanceof ApiError && abfrage.error.status === 404;
  // Ein Hintergrund-Abruf, der auf 404 fällt, lässt `data` stehen; die Freischaltung hängt
  // trotzdem am jüngsten Befund.
  const freigeschaltet = aktiv && !abgeschaltet && abfrage.data !== undefined;
  return {
    freigeschaltet,
    abgeschaltet,
    status: freigeschaltet ? abfrage.data : undefined,
    laedt: aktiv && abfrage.isPending,
    fehler: aktiv && !abgeschaltet ? abfrage.error : null,
    neuLaden: () => void abfrage.refetch(),
  };
}

/**
 * Was nach Import, Neu-Import und Entfernen veraltet ist: Einsatzliste, Demo-Status,
 * Stammdaten-Kataloge samt abgeleiteter Vorschläge und jede Abfrage der betroffenen
 * Demo-Einsätze (alt und neu).
 *
 * Nur `invalidateQueries`, kein `removeQueries`: ein offener Tab des alten Demo-Einsatzes lädt
 * neu und landet auf 404, statt still auf leerem Cache zu stehen.
 * Status-Kataloge, Qualifikationen und Einheitstypen fehlen bewusst: der Import benutzt sie nur
 * mit und legt dort nichts an.
 */
export function invalidiereNachDemoVorgang(
  qc: QueryClient,
  einsatzIds: ReadonlyArray<number | null | undefined>,
): Promise<unknown> {
  const keys = [
    globalKeys.einsaetze(),
    globalKeys.demoDaten(),
    globalKeys.fahrzeuge(),
    globalKeys.fahrzeugVorschlaege(),
    globalKeys.personal(),
    globalKeys.personalVorschlaege(),
    globalKeys.material(),
    globalKeys.materialKategorien(),
  ];
  const ids = [...new Set(einsatzIds.filter((id): id is number => id != null))];
  return Promise.all([
    ...keys.map((queryKey) => qc.invalidateQueries({ queryKey })),
    ...ids.map((id) =>
      qc.invalidateQueries({ predicate: (q) => istKeyDesEinsatzes(q.queryKey, id) }),
    ),
  ]);
}
