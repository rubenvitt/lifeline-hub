import type { Auftrag } from '../../api/types';
import { AUFTRAG_STATUS } from '../../kommunikation';

/**
 * Kapitel Aufträge der Einsatzakte (LLH-1835, Spec `einsatzakte`, „Auftragsliste“): alle
 * Aufträge aufsteigend nach Nummer, aufgehobene bleiben stehen. Rein, damit der Test die Ordnung
 * ohne DOM prüft.
 */
export interface AuftragsZeile {
  id: number;
  nummer: string;
  auftrag: string;
  empfaenger: string;
  status: string;
  erteiltAt: string;
  /** Der Abschluss: aufgehoben, abgenommen oder vollzogen, der jüngste zählt. */
  abschlussAt: string | null;
}

/** Ohne Nummer (Altbestand) hinten, nach Erteilung. */
function vergleiche(a: Auftrag, b: Auftrag): number {
  if (a.lfd_nr != null && b.lfd_nr != null) return a.lfd_nr - b.lfd_nr;
  if (a.lfd_nr != null) return -1;
  if (b.lfd_nr != null) return 1;
  return a.erteilt_at.localeCompare(b.erteilt_at) || a.id - b.id;
}

export function auftragsZeilen(auftraege: readonly Auftrag[]): AuftragsZeile[] {
  return [...auftraege].sort(vergleiche).map((a) => ({
    id: a.id,
    nummer: a.lfd_nr != null ? `#${a.lfd_nr}` : '–',
    auftrag: a.auftrag_text,
    empfaenger: a.empfaenger.map((e) => e.snap_anzeige).join(', '),
    status: (AUFTRAG_STATUS[a.bearbeitungsstatus] ?? AUFTRAG_STATUS.offen).label,
    erteiltAt: a.erteilt_at,
    abschlussAt: a.aufgehoben_at ?? a.abgenommen_at ?? a.vollzogen_at ?? null,
  }));
}
