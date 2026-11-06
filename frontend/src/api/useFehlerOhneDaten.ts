import { useState } from 'react';

/**
 * „Gescheitert ohne Daten" eines Abrufs, das auch während eines neuen Versuchs gilt (LLH-1577).
 *
 * TanStack v5 setzt eine Abfrage ohne Daten bei jedem neuen Abruf auf `pending` zurück und löscht
 * `error`. Ein `isError && !data` wird dann für die Dauer des Abrufs falsch, und ein Fehlerbanner
 * verschwindet, bis die nächste Antwort da ist. Das passiert nicht nur über „Erneut abrufen":
 * Ein zweiter Beobachter desselben Schlüssels, dessen `enabled` erst später wahr wird (auf der
 * Stab-Seite die Besetzung in `useNetzQuellen` hinter den Modul-Freigaben), lädt die gescheiterte
 * Abfrage neu. `retryOnMount: false` hilft dort nicht, das gilt nur beim Einhängen.
 *
 * Deshalb zählt `errorUpdateCount`: Er bleibt über den neuen Abruf stehen und fällt erst mit einem
 * `resetQueries` auf 0. Ohne Daten und mit mindestens einem Fehler ist der Abruf gescheitert, bis
 * Daten kommen. Den Fehler selbst hält der Hook fest, damit die Detailzeile nicht mitflackert.
 * `laedt` sagt, dass gerade ein neuer Versuch läuft.
 */
export function useFehlerOhneDaten(q: {
  data: unknown;
  error: unknown;
  errorUpdateCount: number;
  isFetching: boolean;
}): { gescheitert: boolean; fehler: unknown; laedt: boolean } {
  const [letzterFehler, setLetzterFehler] = useState<unknown>(q.error);
  // Abgeleiteter Zustand im Rendern (React-Muster „Zustand an Props anpassen"): ein Effekt hielte
  // für einen Durchlauf den leeren Fehler und brächte das Flackern der Detailzeile zurück.
  if (q.error != null && q.error !== letzterFehler) setLetzterFehler(q.error);
  const gescheitert = q.data == null && q.errorUpdateCount > 0;
  return {
    gescheitert,
    fehler: q.error ?? letzterFehler,
    laedt: gescheitert && q.isFetching,
  };
}
