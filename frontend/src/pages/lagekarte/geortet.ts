/**
 * Liste „Geortet“ der Kartenleiste (Helfer-App, Spec
 * `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Oberfläche → Lagekarte“):
 * die Ziele, deren Position eine automatische Quelle (Helfer-App, Ortung) gesetzt hat, mit Name,
 * Quelle und Alter. Quelle und Alter trägt der Marker schon als `untertitel` (`marker.ts`,
 * `positionsHinweis`), veraltet ist er mit verringerter `deckkraft`.
 */
import type { KarteMarker } from './marker';

export interface GeortetEintrag {
  schluessel: string;
  label: string;
  /** „Helfer-App · vor 6 min“. */
  quelle: string;
  veraltet: boolean;
}

/** Ist die automatische Position des Markers veraltet (blass gezeichnet)? */
function isVeraltet(m: KarteMarker): boolean {
  return m.deckkraft != null && m.deckkraft < 1;
}

/** Automatisch geortete Ziele, nach Namen. Handpositionen tragen keinen Untertitel und fehlen. */
export function geortetEintraege(verortet: readonly KarteMarker[]): GeortetEintrag[] {
  return verortet
    .filter((m): m is KarteMarker & { untertitel: string } => m.untertitel != null)
    .map((m) => ({
      schluessel: m.schluessel,
      label: m.label,
      quelle: m.untertitel,
      veraltet: isVeraltet(m),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

/**
 * Quelle und Alter einer automatischen Position als Text wie in der Liste „Geortet“ („Ortung ·
 * vor 6 min · veraltet“), etwa für das Datenraster des Paneels „Ausgewählt“ (LLH-2091). Ohne
 * Untertitel (Handposition, keine Position) `null`.
 */
export function positionsHinweisText(m: KarteMarker): { text: string; veraltet: boolean } | null {
  if (m.untertitel == null) return null;
  const veraltet = isVeraltet(m);
  return { text: veraltet ? `${m.untertitel} · veraltet` : m.untertitel, veraltet };
}
