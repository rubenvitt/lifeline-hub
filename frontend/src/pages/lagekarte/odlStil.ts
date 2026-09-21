import type { GlobalToken } from 'antd';
import { odlStufe, rollenFarbe, type StatusDarstellung } from '../../theme/statusFarben';
import type { FeatureCollection, OdlBewertung, OdlStufe } from '../../api/fachebenen';

/**
 * Darstellung der BfS-ODL-Ebene (LFH-78): Rollenfarbe und Punktdurchmesser je Stufe, in die
 * Feature-Properties eingebacken — dieselbe Bauform und Begründung wie `hochwasserStil.ts`
 * (die Kartenstil-Module haben keinen `useToken()`-Zugang, LFH-328/A2).
 *
 * DER RADIUS IST DER ZWEITE KANAL, nicht Schmuck: ein Kreis trägt keine Beschriftung. Die
 * Lücke zwischen `normal` und `erhoeht` ist absichtlich groß — gemessen stehen ~1 600
 * Sonden im natürlichen Bereich, und eine erhöhte muss dazwischen auffallen, ohne dass man
 * die Farbe unterscheiden können muss. `keine_messung` bleibt sichtbar (klein): eine
 * ausgefallene Sonde ist in einer CBRN-Lage eine Lücke im Lagebild.
 */
const RADIUS: Record<OdlStufe, number> = {
  keine_messung: 3,
  normal: 4,
  erhoeht: 7,
  stark_erhoeht: 9,
};

/**
 * Unbekanntes/fehlendes Wort → `keine_messung`: die Ebene erfindet keine Bewertung. Still
 * wie bei `hochwasserStil.ts`, gedeckt durch die beidseitigen Wort-Pins
 * (`karte::normalisierung::odl_tests` ↔ `theme/statusFarben.test.ts`/`odlStil.test.ts`).
 */
function alsStufe(roh: unknown): OdlStufe {
  return typeof roh === 'string' && roh in odlStufe ? (roh as OdlStufe) : 'keine_messung';
}

export function odlRadius(stufe: OdlStufe): number {
  return RADIUS[stufe];
}

/** Vertragsdarstellung (Rolle + Wort) zu einem rohen Stufenwert aus den Properties. */
export function odlDarstellung(roh: unknown): StatusDarstellung {
  return odlStufe[alsStufe(roh)];
}

/** Schreibt `farbe` + `radius` je Feature; Geometrie und übrige Properties bleiben. */
export function faerbeOdl(fc: FeatureCollection, token: GlobalToken): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const stufe = alsStufe(f.properties?.stufe);
      return {
        ...f,
        properties: {
          ...f.properties,
          farbe: rollenFarbe(odlStufe[stufe].rolle, token),
          radius: RADIUS[stufe],
        },
      };
    }),
  };
}

/** Grundlage der Stufe einer Sonde, aus den Properties gelesen (LFH-598). */
export type OdlGrundlage =
  | {
      art: Extract<OdlBewertung, 'standort'>;
      grundpegel: number;
      faktor: number;
      stand: string | null;
    }
  | { art: Extract<OdlBewertung, 'absolut'> };

function endlich(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * `standort` nur, wenn das Wort stimmt UND Grundpegel und Faktor als Zahlen dastehen — sonst
 * `absolut`. Ein unbekanntes Wort oder ein halber Satz Felder zeigt also keinen Grundpegel,
 * statt einen Maßstab zu erfinden, der für die Stufe nicht gegolten hat.
 */
export function odlGrundlage(p: Record<string, unknown> | undefined): OdlGrundlage {
  const grundpegel = endlich(p?.grundpegel);
  const faktor = endlich(p?.faktor);
  if (p?.bewertung === 'standort' && grundpegel !== null && faktor !== null) {
    const stand = typeof p.grundpegel_stand === 'string' ? p.grundpegel_stand : null;
    return { art: 'standort', grundpegel, faktor, stand };
  }
  return { art: 'absolut' };
}
