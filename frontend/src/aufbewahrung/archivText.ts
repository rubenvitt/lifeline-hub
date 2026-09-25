import type { AufbewahrungZustand, EtbTyp, VerbleibArt, VerbleibStatus } from '../api/types';

/**
 * Wörter der Archivakte (LFH-23), die es an keiner exportierten Stelle gibt. Exhaustiv über die
 * generierten Unions: eine neue Variante bricht den Typcheck, statt still zu fehlen.
 */

export const VERBLEIB_ART: Record<VerbleibArt, string> = {
  transport: 'Transport',
  notunterkunft: 'Notunterkunft',
  entlassung: 'entlassen',
  vor_ort: 'vor Ort',
  verstorben: 'verstorben',
};

export const VERBLEIB_STATUS: Record<VerbleibStatus, string> = {
  angemeldet: 'angemeldet',
  abtransportiert: 'abtransportiert',
};

/**
 * Rang der Zustände entlang der Lebenslinie eines Einsatzes — ein exhaustiver Record: ein
 * siebter Zustand bricht den Typcheck, statt still in Auswahl und Sortierung zu fehlen.
 */
export const ZUSTAND_RANG: Record<AufbewahrungZustand, number> = {
  ohne_frist: 0,
  frist_laeuft: 1,
  faellig: 2,
  vorgemerkt: 3,
  schwaerzung_ausstehend: 4,
  geschwaerzt: 5,
};

/** Die Zustände in Rangfolge — abgeleitet, nicht handgepflegt. */
export const ZUSTAENDE: readonly AufbewahrungZustand[] = (
  Object.keys(ZUSTAND_RANG) as AufbewahrungZustand[]
).sort((a, b) => ZUSTAND_RANG[a] - ZUSTAND_RANG[b]);

/**
 * Reihenfolge der ETB-Typen im Filter des Archiv-ETB — exhaustiv über `EtbTyp`, damit ein
 * neuer Typ im Filter nicht still fehlt (Muster `ETB_TYP_ERLAUBT` in `routing/deeplinks.ts`).
 */
const ETB_TYP_RANG: Record<EtbTyp, number> = {
  meldung: 0,
  anordnung: 1,
  lage: 2,
  entscheidung: 3,
  berichtigung: 4,
  system: 5,
};

export const ETB_TYPEN: readonly EtbTyp[] = (Object.keys(ETB_TYP_RANG) as EtbTyp[]).sort(
  (a, b) => ETB_TYP_RANG[a] - ETB_TYP_RANG[b],
);

/** Welche EINE Primäraktion die Akte im Kopf trägt (design.md D8). Nach Karenz-Ende und nach
 *  der Schwärzung gibt es keine: der Server lehnt dort mit 409 ab, und ein Knopf, der nur
 *  abgelehnt werden kann, ist schlechter als keiner. */
export type AktePrimaeraktion = 'frist' | 'wiederherstellen' | null;

export function primaeraktion(zustand: AufbewahrungZustand): AktePrimaeraktion {
  switch (zustand) {
    case 'ohne_frist':
    case 'frist_laeuft':
    case 'faellig':
      return 'frist';
    case 'vorgemerkt':
      return 'wiederherstellen';
    case 'schwaerzung_ausstehend':
    case 'geschwaerzt':
      return null;
  }
}
