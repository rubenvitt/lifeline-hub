/**
 * Zweistufiges Esc beim Zeichnen (LFH-712, Entscheidung des Auftraggebers vom 28.09.2026:
 * „je öfter Esc, desto mehr Richtung view-only"). Rein und exportiert, damit jede Zeile der
 * Stufentafel ohne Karte prüfbar ist; die Seite führt nur aus, was hier entschieden wird.
 *
 * Esc gehört dabei der Seite, nicht terra-draw — Begründung in `zeichnen.ts` (`keyEvents`)
 * und `openspec/changes/lfh-712-lagekarte-zeichnen-korrigierbar/design.md` D2. Das Messen
 * endet weiterhin mit einem Esc; es läuft über einen eigenen Zuhörer der Seite.
 */

export interface EscLage {
  phase: 'zeichnen' | 'bestaetigen';
  speichernLaeuft: boolean;
  /** Punkte der laufenden Figur (Zeichenphase). */
  punkte: number;
  /** In der laufenden Zonen-Serie schon gespeicherte Objekte; 0 ohne Serie. */
  serieGespeichert: number;
}

export type EscStufe =
  /** Nichts tun (Speichern läuft). */
  | 'nichts'
  /** Fertige, ungespeicherte Figur verwerfen, zurück in die Zeichenphase. */
  | 'zurueckZumZeichnen'
  /** Angefangene Figur verwerfen, im Zeichenmodus bleiben. */
  | 'verwerfen'
  /** Zeichenmodus beenden; die schon gespeicherten Serienobjekte bleiben („Fertig"). */
  | 'fertig'
  /** Zeichenmodus beenden („Abbrechen"). */
  | 'abbrechen';

export function escStufe(lage: EscLage): EscStufe {
  if (lage.speichernLaeuft) return 'nichts';
  if (lage.phase === 'bestaetigen') return 'zurueckZumZeichnen';
  if (lage.punkte > 0) return 'verwerfen';
  return lage.serieGespeichert > 0 ? 'fertig' : 'abbrechen';
}

/** Die Quittung der beiden verwerfenden Stufen — ein Wortlaut, an einer Stelle. */
export const QUITTUNG_VERWORFEN = 'Zeichnung verworfen';
