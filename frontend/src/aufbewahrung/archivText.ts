import type { AufbewahrungZustand, VerbleibArt, VerbleibStatus } from '../api/types';

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

/** Reihenfolge der Zustände in der Auswahl — die Lebenslinie eines Einsatzes. */
export const ZUSTAENDE: readonly AufbewahrungZustand[] = [
  'ohne_frist',
  'frist_laeuft',
  'faellig',
  'vorgemerkt',
  'schwaerzung_ausstehend',
  'geschwaerzt',
];

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
