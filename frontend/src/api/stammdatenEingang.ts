import { apiUpload } from './client';
import type { StammdatenEntscheidungen, StammdatenErgebnis, StammdatenVorschau } from './types';

/**
 * Stammdaten einlesen (LLH-1633): Fahrzeuge, Personal und Qualifikationen aus einer CSV- oder
 * Excel-Datei. Die Vorschau schreibt nichts; jede Wahl schickt Datei und Entscheidungen neu,
 * „Übernehmen“ schickt dieselben Teile. Eine unlesbare Datei oder eine fehlende Herkunft ist
 * 400, eine Organisation, die an einem Hub hängt, 409, nicht Übernehmbares 422 mit den Zeilen.
 */

const BASIS = '/api/master-data/import';

/** Zeit für Lesen und Abgleich einer großen Datei (bis 5.000 Zeilen). */
const EINLESEN_TIMEOUT_MS = 60_000;

/** Keine Entscheidung: es gilt überall der Vorschlag des Servers. */
export const LEERE_ENTSCHEIDUNGEN: StammdatenEntscheidungen = { zeilen: [], qualifikationen: [] };

function einleseDaten(
  datei: File,
  herkunft: string | undefined,
  entscheidungen: StammdatenEntscheidungen,
): FormData {
  const daten = new FormData();
  daten.append('datei', datei);
  const h = herkunft?.trim();
  if (h) daten.append('herkunft', h);
  daten.append('entscheidungen', JSON.stringify(entscheidungen));
  return daten;
}

/** Vorschau: Abgleich, Zählung, Fehler und offene Entscheidungen; nichts geschrieben. */
export function stammdatenEinlesenVorschau(
  datei: File,
  herkunft: string | undefined,
  entscheidungen: StammdatenEntscheidungen,
): Promise<StammdatenVorschau> {
  return apiUpload<StammdatenVorschau>(
    `${BASIS}/preview`,
    einleseDaten(datei, herkunft, entscheidungen),
    { timeoutMs: EINLESEN_TIMEOUT_MS },
  );
}

/** Übernehmen: dieselbe Datei, Herkunft und Wahl wie die letzte Vorschau, alles oder nichts. */
export function stammdatenEinlesen(
  datei: File,
  herkunft: string | undefined,
  entscheidungen: StammdatenEntscheidungen,
): Promise<StammdatenErgebnis> {
  return apiUpload<StammdatenErgebnis>(BASIS, einleseDaten(datei, herkunft, entscheidungen), {
    timeoutMs: EINLESEN_TIMEOUT_MS,
  });
}
