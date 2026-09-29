/**
 * Die Kennzahl „Evakuiert N · von M geplant" — reine Ableitung aus den Bezirken der Übersicht
 * (`GET …/betreuung`), für Modulseite, Modulzähler und Lage-Dashboard.
 *
 * Das Prädikat {@link istAktiverBezirk} steht wortgleich im Backend als Auslöser der
 * Lagekennzahl `evakuiert` (`lagekennzahl::ableiten`); wer es ändert, ändert beide.
 *
 * Die Funktion bekommt NUR Daten: `null` heißt „keine geplante Evakuierung". Ein
 * fehlgeschlagener Abruf darf nie so aussehen; das trennt `useEvakuierungKennzahl`.
 *
 * Festlegungen, jede in `evakuierungKennzahl.test.ts` gepinnt:
 *  - **Maßgeblich sind die aktiven Bezirke**: nicht storniert und nicht `aufgehoben`. Ein
 *    `geraeumt`er zählt weiter. Gefiltert wird auch Storniertes, weil eine Mutationsantwort mit
 *    `storniert_at` im Cache landen kann.
 *  - **M** ist die Summe der Plangrößen ALLER aktiven Bezirke, auch derer ohne Meldung.
 *  - **N** ist die Summe der aktuellen Stände; ein Bezirk ohne Meldung zählt in `ohneMeldung`,
 *    nicht als 0. Ohne jede Meldung ist N `null`.
 *  - **N wird nicht auf M gedeckelt.**
 *  - **geschätzt**, sobald eine beteiligte Plangröße ODER ein beteiligter Stand geschätzt ist.
 */
import type { Evakuierungsbezirk } from '../api/types';

/** Was die Kennzahl von einem Bezirk liest — schmal, damit Zähler und Tests nicht mehr
 *  bauen müssen als nötig. */
type KennzahlBezirk = Pick<
  Evakuierungsbezirk,
  'raeumung' | 'storniert_at' | 'plan_personen' | 'plan_erhebung' | 'stand'
>;

export interface EvakuierungKennzahl {
  /** N: Summe der aktuellen Stände. `null`, wenn kein aktiver Bezirk eine Meldung hat. */
  evakuiert: number | null;
  /** M: Summe der Plangrößen aller aktiven Bezirke. */
  geplant: number;
  /** Zahl der aktiven Bezirke. */
  bezirke: number;
  /** Zahl der aktiven Bezirke ohne Standmeldung — ausgewiesen statt als 0 gezählt. */
  ohneMeldung: number;
  /** Eine beteiligte Plangröße oder ein beteiligter Stand ist geschätzt. */
  geschaetzt: boolean;
}

/**
 * Die EINE Definition von „aktiv" für Kennzahl und Modulzähler: nicht storniert und nicht
 * aufgehoben. Rein.
 */
export function istAktiverBezirk(
  b: Pick<Evakuierungsbezirk, 'raeumung' | 'storniert_at'>,
): boolean {
  return !b.storniert_at && b.raeumung !== 'aufgehoben';
}

/** Kennzahl aus den Bezirken; `null` ohne aktiven Bezirk (keine geplante Evakuierung). Rein. */
export function evakuierungKennzahl(
  bezirke: readonly KennzahlBezirk[],
): EvakuierungKennzahl | null {
  const aktive = bezirke.filter(istAktiverBezirk);
  if (aktive.length === 0) return null;
  let geplant = 0;
  let evakuiert: number | null = null;
  let ohneMeldung = 0;
  let geschaetzt = false;
  for (const b of aktive) {
    geplant += b.plan_personen;
    if (b.plan_erhebung === 'geschaetzt') geschaetzt = true;
    if (b.stand) {
      evakuiert = (evakuiert ?? 0) + b.stand.evakuiert;
      if (b.stand.erhebung === 'geschaetzt') geschaetzt = true;
    } else {
      ohneMeldung += 1;
    }
  }
  return { evakuiert, geplant, bezirke: aktive.length, ohneMeldung, geschaetzt };
}
