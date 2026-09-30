import type { CSSProperties } from 'react';
import type { ChecklistenEintrag, ChecklistenPunkt } from '../api/types';

/**
 * Checkliste Arbeitsaufnahme der Führungseinheit (LFH-551) — Text und Quelle je Punkt.
 *
 * Ein ARBEITSMITTEL für die ersten Minuten am Fahrzeug, kein Führungsnachweis: die Punkte sind
 * Lehrmeinung (LFS-BW F5-I Kap. 5, S. 33–34; die HLFS-Fassung „Aufgaben S3" Kap. 5, S. 12 liegt
 * nur als Bild vor und wird deshalb nicht je Punkt zitiert). Nur die zwei Punkte, die die
 * FwDV 100 selbst dokumentiert sehen will (Anlage 5, S. 64), nennen sie zusätzlich.
 *
 * Die Reihenfolge ist die von `ChecklistenPunkt::ALLE` in `src/stab/checkliste.rs` und Teil des
 * Vertrags (`checkliste.test.ts` prüft sie gegen den generierten Typ). Kein Punkt wird aus einem
 * anderen Modul abgeleitet — „ETB eröffnet" hakt der Mensch ab, nicht die Existenz eines
 * Eintrags: eine Ableitung wäre eine zweite Wahrheit.
 */
export interface ChecklistenVorlage {
  punkt: ChecklistenPunkt;
  text: string;
  quelle: string;
}

const LFS_BW = 'LFS-BW F5-I Kap. 5, S. 33–34';

export const CHECKLISTE: readonly ChecklistenVorlage[] = [
  { punkt: 'aufstellort', text: 'Aufstellort des ELW festgelegt', quelle: LFS_BW },
  { punkt: 'einweisung', text: 'Einweisung durch die Einsatzleitung erhalten', quelle: LFS_BW },
  { punkt: 'lageskizze', text: 'Lageskizze begonnen', quelle: LFS_BW },
  { punkt: 'funkarbeitsplaetze', text: 'Funkarbeitsplätze eingerichtet', quelle: LFS_BW },
  { punkt: 'sprechgruppen', text: 'Sprechgruppen zugeteilt', quelle: LFS_BW },
  {
    punkt: 'etb_eroeffnet',
    text: 'Einsatztagebuch eröffnet',
    quelle: `FwDV 100 Anl. 5, S. 64; ${LFS_BW}`,
  },
  {
    punkt: 'leitstelle_gemeldet',
    text: 'Einsatzbereitschaft an die Leitstelle gemeldet',
    quelle: `FwDV 100 Anl. 5, S. 64; ${LFS_BW}`,
  },
];

/** Der gespeicherte Eintrag eines Punkts; `undefined` heißt offen, ohne Bemerkung. */
export function eintragFuer(
  liste: readonly ChecklistenEintrag[] | undefined,
  punkt: ChecklistenPunkt,
): ChecklistenEintrag | undefined {
  return liste?.find((e) => e.punkt === punkt);
}

/** Zahl der Haken — nicht der Zeilen: eine Bemerkung allein legt auch eine Zeile an. */
export function erledigtAnzahl(liste: readonly ChecklistenEintrag[]): number {
  return liste.filter((e) => e.erledigt).length;
}

/**
 * Stil des Zeilen-Labels, das Box und Text umschließt. Ein handgebautes Bedienziel schuldet
 * ZWEI Angaben (LFH-365): den Boden aus `controlHeight` — die antd-Box selbst ist nur
 * `controlInteractiveSize` groß und erbt keine Steuerhöhe — und die Polsterung. Rein und
 * exportiert (Muster `bedienzielStil`), aufgelöste Tokens, nie `var(--lfh-*)`.
 */
export function checklistenZeileStil(token: {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: token.paddingSM,
    minHeight: token.controlHeight,
    paddingBlock: token.paddingXS,
    paddingInline: token.paddingSM,
    cursor: 'pointer',
  };
}
