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

/** Automatisch geortete Ziele, nach Namen. Handpositionen tragen keinen Untertitel und fehlen. */
export function geortetEintraege(verortet: readonly KarteMarker[]): GeortetEintrag[] {
  return verortet
    .filter((m): m is KarteMarker & { untertitel: string } => m.untertitel != null)
    .map((m) => ({
      schluessel: m.schluessel,
      label: m.label,
      quelle: m.untertitel,
      veraltet: m.deckkraft != null && m.deckkraft < 1,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}
