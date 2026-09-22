import type { CSSProperties } from 'react';
import type { Farbrollen } from '../../theme/tokens';

/**
 * Stile des Führungsüberblicks — rein und exportiert (Muster `bedienzielStil`), damit die
 * Zusicherungen ohne Render prüfbar sind.
 */

/** Breite des Seitenfelds „Nächste Marken" (Entwurf S2: 280 px). */
export const MARKEN_BREITE = 280;

/**
 * Eine ganze Paneelzeile als Link — ein HANDGEBAUTES Bedienziel, also die ZWEI Angaben
 * aus LFH-365: `minHeight: token.controlHeight` plus Polsterung aus der Staffel. Die
 * Polsterung allein trüge den Handschuh-Boden (72 px) nicht. Trenner `flaeche3` wie
 * `paneelZeileStil`.
 */
export function zeilenzielStil(
  rollen: Pick<Farbrollen, 'text' | 'flaeche3'>,
  token: { controlHeight: number; padding: number; paddingSM: number },
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: token.padding,
    minHeight: token.controlHeight,
    paddingBlock: token.paddingSM,
    paddingInline: token.padding,
    borderBlockEnd: `1px solid ${rollen.flaeche3}`,
    color: rollen.text,
    textDecoration: 'none',
    boxSizing: 'border-box',
  };
}

/**
 * Raster der Seite: zwei Spalten 1.35fr / 1fr ab `lg`, darunter alles gestapelt. Die
 * Schwelle liest der Aufrufer aus `useViewport` — eine reine Funktion, die selbst einen
 * Hook ruft, wäre kein Prüfobjekt mehr.
 */
export function rasterStil(breit: boolean, abstand: number): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: breit ? 'minmax(0, 1.35fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
    gap: abstand,
    alignItems: 'start',
  };
}
