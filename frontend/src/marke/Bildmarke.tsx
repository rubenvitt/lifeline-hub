/**
 * Bildmarke „Lebenslinie“ (LFH-837): das Zeichen der App in der Oberfläche.
 *
 * Geometrie aus `bildmarkeGeometrie.ts`, dieselbe wie in Favicon, PWA- und Desktop-Symbol. Die
 * Linie nimmt die Textfarbe ihres Grundes von außen, denn der Rahmen ist immer dunkel, die
 * Anmeldeseite folgt der Betriebsart. Das Quadrat ist immer `marke`, Rot bleibt Akzent.
 *
 * Reine Dekoration: `aria-hidden`, nicht fokussierbar. Den zugänglichen Namen der App trägt
 * die Wortmarke daneben.
 */
import { farbenDunkel } from '../theme/tokens';
import {
  LINIE_PFAD,
  LINIE_STAERKE,
  MARKE_RAHMEN,
  MARKE_VIEWBOX,
  QUADRAT,
} from './bildmarkeGeometrie';

export function Bildmarke({ hoehe, linienFarbe }: { hoehe: number; linienFarbe: string }) {
  return (
    <svg
      data-lfh="bildmarke"
      aria-hidden="true"
      focusable="false"
      viewBox={MARKE_VIEWBOX}
      height={hoehe}
      width={(hoehe * MARKE_RAHMEN.breite) / MARKE_RAHMEN.hoehe}
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d={LINIE_PFAD}
        fill="none"
        stroke={linienFarbe}
        strokeWidth={LINIE_STAERKE}
        strokeLinejoin="miter"
        strokeMiterlimit={10}
      />
      <rect
        x={QUADRAT.x}
        y={QUADRAT.y}
        width={QUADRAT.kante}
        height={QUADRAT.kante}
        fill={farbenDunkel.marke}
      />
    </svg>
  );
}
