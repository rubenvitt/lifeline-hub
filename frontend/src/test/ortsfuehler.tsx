import { useLocation } from 'react-router';

/**
 * Die aktuelle Adresse, wie der Router sie hält (LLH-1096): Listen schreiben Sortierung, Filter und
 * Suche mit `replace` in die Adresse (`components/listenGedaechtnis.ts`). Neben die Seite in den
 * Router gehängt, steht danach in {@link ort} `pfad?suche`.
 */
export const ort = { aktuell: '' };

export function Ortsfuehler() {
  const l = useLocation();
  ort.aktuell = `${l.pathname}${l.search}`;
  return null;
}
