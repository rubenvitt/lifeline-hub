import type { BrPatch } from '../../api/einsatzBereitstellungsraum';
import { leerZuNull } from '../../api/patchTriState';
import type { Bereitstellungsraum } from '../../api/types';
import type { OrtsfeldWert } from '../../anzeige/Ortsfeld';
import { ortFelder, ortsfeldAusGespeichert } from '../../anzeige/ortsfeldFormular';

/** Formularwerte des Paneels „Raumdaten“ (LLH-1920). */
export interface BrRaumdatenWerte {
  bezeichnung: string;
  /** Ortsfeld (LLH-1114): Text und Koordinate des Standorts. */
  standort: OrtsfeldWert;
  notiz: string;
}

/** Die Werte eines Raums, wie das Paneel sie beim Öffnen einfriert. */
export function brRaumdatenWerte(br: Bereitstellungsraum): BrRaumdatenWerte {
  return {
    bezeichnung: br.bezeichnung,
    standort: ortsfeldAusGespeichert(br.standort, br.lat, br.lon),
    notiz: br.notiz ?? '',
  };
}

/**
 * Nur die geänderten Felder (LFH-1147), gemessen an den Werten beim Öffnen (`vorher`): der PATCH
 * ist ein Teil-Patch, fehlender Key = unverändert. Wer nur die Notiz ändert, überschreibt so nicht
 * den Standort, den ein anderer Arbeitsplatz inzwischen gesetzt hat. Leer heißt löschen (`null`);
 * der Server trimmt ebenso. Die Koordinate des Standorts (LLH-1114) geht nur als Paar und nur bei
 * einer Änderung hinaus; ein geleerter Standort leert sie mit (`ortFelder`).
 */
export function brPatch(vorher: BrRaumdatenWerte, nachher: BrRaumdatenWerte): BrPatch {
  const patch: BrPatch = {};
  const bezeichnung = nachher.bezeichnung.trim();
  if (bezeichnung !== vorher.bezeichnung.trim()) patch.bezeichnung = bezeichnung;
  const alt = ortFelder(vorher.standort);
  const neu = ortFelder(nachher.standort);
  if (neu.text !== alt.text) patch.standort = neu.text;
  if (neu.lat !== alt.lat || neu.lon !== alt.lon) {
    patch.lat = neu.lat;
    patch.lon = neu.lon;
  }
  const notiz = leerZuNull(nachher.notiz);
  if (notiz !== leerZuNull(vorher.notiz)) patch.notiz = notiz;
  return patch;
}
