import type { UhsPatch } from '../../api/einsatzUhs';
import { leerZuNull } from '../../api/patchTriState';
import type { Uhs } from '../../api/types';
import type { OrtsfeldWert } from '../../anzeige/Ortsfeld';
import { ortFelder, ortsfeldAusGespeichert } from '../../anzeige/ortsfeldFormular';
import { vollstaendig, type QualiSollZeile } from '../../kraefte/QualiSollFeld';
import { gleichesQualiSoll, qualiSollEingabe } from '../../kraefte/qualiSoll';

/** Formularwerte des Paneels „Angaben“ einer UHS (LLH-1920). */
export interface UhsAngabenWerte {
  bezeichnung: string;
  /** Ortsfeld (LLH-1114): Text und Koordinate des Standorts. */
  standort: OrtsfeldWert;
  /** LLH-1553: Soll-Anzahl und Qualifikationssoll. */
  soll_anzahl: number | null;
  quali_soll: QualiSollZeile[];
  notiz: string;
}

/** Die Werte einer UHS, wie das Paneel sie beim Öffnen einfriert. */
export function uhsAngabenWerte(uhs: Uhs): UhsAngabenWerte {
  return {
    bezeichnung: uhs.bezeichnung,
    standort: ortsfeldAusGespeichert(uhs.standort, uhs.lat, uhs.lon),
    soll_anzahl: uhs.soll_anzahl ?? null,
    quali_soll: qualiSollEingabe(uhs.quali_soll),
    notiz: uhs.notiz ?? '',
  };
}

/**
 * Nur die geänderten Felder (LLH-1407), gemessen an den Werten beim Öffnen (`vorher`): der PATCH
 * ist ein Teil-Patch, fehlender Key = unverändert. Leer heißt löschen (`null`); der Server trimmt
 * ebenso. Die Koordinate des Standorts geht nur als Paar und nur bei einer Änderung hinaus; ein
 * geleerter Standort leert sie mit (`ortFelder`). Eine angefangene Soll-Zeile ohne Qualifikation
 * zählt nicht (`vollstaendig`).
 */
export function uhsPatch(vorher: UhsAngabenWerte, nachher: UhsAngabenWerte): UhsPatch {
  const patch: UhsPatch = {};
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
  const sollAnzahl = nachher.soll_anzahl ?? null;
  if (sollAnzahl !== (vorher.soll_anzahl ?? null)) patch.soll_anzahl = sollAnzahl;
  const qualiSoll = vollstaendig(nachher.quali_soll);
  if (!gleichesQualiSoll(qualiSoll, vollstaendig(vorher.quali_soll))) {
    patch.quali_soll = qualiSoll.length > 0 ? qualiSoll : null;
  }
  return patch;
}
