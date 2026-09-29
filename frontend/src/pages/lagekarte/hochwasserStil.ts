import type { GlobalToken } from 'antd';
import { hochwasserKlasse, rollenFarbe, type StatusDarstellung } from '../../theme/statusFarben';
import type { FeatureCollection, HochwasserKlasse } from '../../api/fachebenen';

/**
 * Darstellung der LHP-Hochwasserebene: Rollenfarbe und Punktdurchmesser je Pegelklasse, in die
 * Feature-Properties eingebacken — die Farbe kommt aus dem aufgelösten Token, und die
 * Kartenstil-Module haben keinen `useToken()`-Zugang (siehe Kopf von `marker.ts`).
 * `useLagekarteDaten` kennt den Modus und schreibt den fertigen Wert, der Layer liest ihn per
 * `['get', …]`.
 *
 * Der Radius ist kein Schmuck: ein Kreis trägt keine Beschriftung, ohne ihn unterschiede die Ebene
 * sieben Klassen über drei Rollenfarben (WCAG 1.4.1). Die grobe Trennung (gemeldet sticht heraus)
 * folgt dem Portal (`js/lage-basics.js:getRadiusPegel`); die feine Staffel innerhalb der vier
 * Meldeklassen ist hinzugefügt, weil `hochwasserKlasse` sie auf zwei Farben legt.
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
 * Unbekannter/fehlender Wert → „keine Daten": die Ebene erfindet keine Meldeklasse. Der Rückfall
 * ist still, aber ein geändertes Wort bleibt nicht unbemerkt: Rust pinnt seine Literale in
 * `karte::normalisierung::hochwasser_tests::bildet_die_hochwasserklassen_ab`, das Frontend in
 * `theme/statusFarben.test.ts`. Wer eine neue Klasse einführt, fasst beide Pins an.
 */
function alsKlasse(roh: unknown): HochwasserKlasse {
  // Eigene Schlüssel, nicht `in` (sähe die Prototypkette). `Object.hasOwn` scheidet wegen `lib:
  // ES2020` aus.
  return typeof roh === 'string' && Object.prototype.hasOwnProperty.call(hochwasserKlasse, roh)
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
