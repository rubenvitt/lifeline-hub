import type { BenutzerAnzeige, MeAntwort } from '../api/types';
import type { LagebildDatensatz } from './lagebildSpeicher';

/**
 * Höchstliegezeit eines vorgehaltenen Stands ohne Serverbestätigung (LFH-723, Entscheidung
 * des Auftraggebers 28.09.2026): eine Einsatzschicht plus Übergabe. Gezählt ab der letzten
 * erfolgreichen Server-Antwort (`bestaetigtAt`), NICHT ab dem letzten Speichern — gespeichert
 * wird bei jeder Cache-Änderung, auch einer ohne Server, und die Frist verlängerte sich sonst
 * beliebig (design.md D4).
 */
export const HOECHSTLIEGEZEIT_MS = 24 * 60 * 60 * 1000;

/** Ausgang der Sitzungsprüfung beim Start. `abgelehnt` ist JEDE Server-Antwort ungleich
 *  Erfolg (401 und alle anderen) — nur ein Netzfehler öffnet die Offline-Identität. */
export type MeErgebnis =
  { art: 'ok'; benutzer: MeAntwort } | { art: 'abgelehnt' } | { art: 'netzfehler' };

export interface StartEntscheidung {
  benutzer: BenutzerAnzeige | null;
  wiederherstellen: boolean;
  loeschen: boolean;
}

function gueltig(satz: LagebildDatensatz, jetzt: number, buster: string): boolean {
  return satz.buster === buster && jetzt - satz.bestaetigtAt <= HOECHSTLIEGEZEIT_MS;
}

/** Wer ist angemeldet, und darf der vorgehaltene Stand in den Speicher? (design.md D2) */
export function startEntscheidung(
  me: MeErgebnis,
  satz: LagebildDatensatz | undefined,
  jetzt: number,
  buster: string,
): StartEntscheidung {
  if (me.art === 'abgelehnt') {
    return { benutzer: null, wiederherstellen: false, loeschen: true };
  }
  if (me.art === 'netzfehler') {
    if (satz && gueltig(satz, jetzt, buster)) {
      return { benutzer: satz.benutzer, wiederherstellen: true, loeschen: false };
    }
    return { benutzer: null, wiederherstellen: false, loeschen: satz !== undefined };
  }
  if (!satz) return { benutzer: me.benutzer, wiederherstellen: false, loeschen: false };
  const passt = satz.benutzer.id === me.benutzer.id && gueltig(satz, jetzt, buster);
  return { benutzer: me.benutzer, wiederherstellen: passt, loeschen: !passt };
}
