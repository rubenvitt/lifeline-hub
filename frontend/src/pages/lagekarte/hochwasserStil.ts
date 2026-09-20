import type { GlobalToken } from 'antd';
import { hochwasserKlasse, rollenFarbe, type StatusDarstellung } from '../../theme/statusFarben';
import type { FeatureCollection, HochwasserKlasse } from '../../api/fachebenen';

/**
 * Darstellung der LHP-Hochwasserebene (LFH-77): Rollenfarbe und Punktdurchmesser je
 * Pegelklasse, in die Feature-Properties eingebacken.
 *
 * WARUM EINGEBACKEN und nicht als MapLibre-Ausdruck über `klasse`: die Farbe kommt aus
 * dem aufgelösten antd-Token (Hell/Dunkel), und die Kartenstil-Module haben bewusst
 * keinen `useToken()`-Zugang (LFH-328/A2, siehe Kopf von `marker.ts`). Dieselbe
 * Arbeitsteilung wie bei den Zonen: `useLagekarteDaten` kennt den Modus und schreibt den
 * fertigen Wert ins Feature, der Layer liest ihn per `['get', …]`.
 *
 * DER RADIUS IST NICHT SCHMUCK. Ein Kreis trägt keine Beschriftung; ohne ihn
 * unterschiede die Ebene ihre sieben Klassen allein über drei Rollenfarben (WCAG 1.4.1).
 * Die Staffelung ist die Lesart des Portals selbst (`js/lage-basics.js:getRadiusPegel`):
 * gemeldetes Hochwasser sticht heraus, ein stummer Pegel bleibt ein kleiner Punkt.
 */
const RADIUS: Record<HochwasserKlasse, number> = {
  keine_daten: 3,
  unklassifiziert: 3,
  kein_hochwasser: 4,
  klein: 6,
  mittel: 7,
  gross: 8,
  sehr_gross: 9,
};

/**
 * Alle Klassen des Wire-Vertrags. AUS DEM VERTRAG ABGELEITET, nicht danebengeschrieben:
 * `hochwasserKlasse` ist ein `Record<HochwasserKlasse, …>` und damit vollständig — eine
 * eigene Literalliste könnte eine Klasse verlieren, ohne dass der Typcheck etwas merkt.
 * Die Wörter selbst sind in `hochwasserStil.test.ts` gegen Literale gepinnt.
 */
export const HOCHWASSER_KLASSEN = Object.keys(hochwasserKlasse) as HochwasserKlasse[];

/** Unbekannter/fehlender Wert → „keine Daten": die Ebene erfindet keine Meldeklasse. */
function alsKlasse(roh: unknown): HochwasserKlasse {
  return typeof roh === 'string' && roh in hochwasserKlasse
    ? (roh as HochwasserKlasse)
    : 'keine_daten';
}

export function hochwasserRadius(klasse: HochwasserKlasse): number {
  return RADIUS[klasse];
}

/** Vertragsdarstellung (Rolle + Wort) zu einem rohen Klassenwert aus den Properties;
 *  Unbekanntes fällt auf „keine Daten", statt den Rohwert in die Oberfläche zu lassen. */
export function hochwasserDarstellung(roh: unknown): StatusDarstellung {
  return hochwasserKlasse[alsKlasse(roh)];
}

/** Schreibt `farbe` + `radius` je Feature; Geometrie und übrige Properties bleiben. */
export function faerbeHochwasser(fc: FeatureCollection, token: GlobalToken): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const klasse = alsKlasse(f.properties?.klasse);
      return {
        ...f,
        properties: {
          ...f.properties,
          farbe: rollenFarbe(hochwasserKlasse[klasse].rolle, token),
          radius: RADIUS[klasse],
        },
      };
    }),
  };
}
