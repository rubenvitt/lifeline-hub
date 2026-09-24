/**
 * Die Kennzahl „Evakuiert N · von M geplant" (LFH-639, design.md D9) — reine Ableitung aus
 * den Bezirken der Übersicht (`GET …/betreuung`), nach dem Vorbild von
 * `pegel/pegelKennzahl.ts`.
 *
 * EINE Quelle für drei Leser: die Modulseite, den Modulzähler (`useModulZaehler.ts`) und die
 * Zelle „Evakuiert" im Lage-Dashboard (LFH-607, über `useEvakuierungKennzahl`). Die Datei liegt
 * deshalb unter `betreuung/` und nicht unter einer Seite: eine Seite, die aus dem Verzeichnis
 * einer anderen importiert, wäre eine neue Querabhängigkeit.
 *
 * Das Prädikat von {@link istAktiverBezirk} steht wortgleich im Backend, als Auslöser der
 * Lagekennzahl `evakuiert` (`src/einsatz/repo.rs`, `lagekennzahl::ableiten`). Wer es hier
 * ändert, ändert es dort mit — sonst steht „Evakuiert" auf dem Platz und die Kennzahl daneben
 * ist leer.
 *
 * DIE FUNKTION BEKOMMT NUR DATEN. „Keine Kennzahl" (`null`) heißt: es gibt keine geplante
 * Evakuierung. Ein fehlgeschlagener Abruf ist etwas anderes und darf nie so aussehen — diese
 * Unterscheidung trägt der Aufrufer über den Query-Zustand (`useEvakuierungKennzahl`).
 *
 * Festlegungen, jede in `evakuierungKennzahl.test.ts` gepinnt:
 *
 *  - **Maßgeblich sind die aktiven Bezirke** ({@link istAktiverBezirk}): nicht storniert und
 *    nicht `aufgehoben`. Ein `geraeumt`er Bezirk zählt weiter — er ist das Ergebnis, nicht
 *    sein Ende. Stornierte liefert die Übersicht nicht; gefiltert wird trotzdem, weil eine
 *    Mutationsantwort (`storniereBezirk`) mit `storniert_at` im Cache landen kann.
 *  - **M** ist die Summe der Plangrößen ALLER aktiven Bezirke, auch derer ohne Meldung.
 *  - **N** ist die Summe der aktuellen Stände — ein Bezirk ohne Meldung geht NICHT als 0 ein,
 *    sondern zählt in `ohneMeldung`. Hat kein aktiver Bezirk eine Meldung, ist N `null`:
 *    „nichts gemeldet" ist nicht „niemand evakuiert" (dieselbe Unterscheidung wie die
 *    Kopfzahl im Backend, dort über `stellen_ohne_meldung`).
 *  - **N wird nicht auf M gedeckelt.** Mehr Evakuierte als geplant ist eine Aussage über die
 *    Plangröße, keine Rundungsfrage.
 *  - **geschätzt**, sobald eine beteiligte Plangröße ODER ein beteiligter Stand geschätzt
 *    ist. Nicht beteiligte (aufgehobene, stornierte) Bezirke färben nicht ab.
 */
import type { Evakuierungsbezirk } from '../api/types';

/** Was die Kennzahl von einem Bezirk liest — schmal, damit Zähler und Tests nicht mehr
 *  bauen müssen als nötig. */
export type KennzahlBezirk = Pick<
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
 * aufgehoben. Zwei Definitionen ließen den Zähler in der Navigation und die Kennzahl
 * auseinanderlaufen. Rein.
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
