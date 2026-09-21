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
 *
 * Die GROBE Trennung — gemeldetes Hochwasser sticht heraus, ein stummer Pegel bleibt ein
 * kleiner Punkt — ist die Lesart des Portals (`js/lage-basics.js:getRadiusPegel` vergibt
 * bei Zoom ≥ 8: unklassifiziert 4, `-1`/`0` 6, Klassen 1–4 einheitlich 7). Die feine
 * Staffelung innerhalb der vier Meldeklassen ist es NICHT — sie ist hier hinzugefügt,
 * weil `hochwasserKlasse` vier Klassen auf zwei Rollenfarben legt und der Radius die
 * Auflösung zurückholt, die die Farbe verliert. Wer sie wieder einebnet, nimmt der Karte
 * den Unterschied zwischen `klein` und `mittel` bzw. `gross` und `sehr_gross` ganz.
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
 * Unbekannter/fehlender Wert → „keine Daten": die Ebene erfindet keine Meldeklasse.
 *
 * Dieser Rückfall ist STILL — eine Wire-Drift ergäbe eine flächendeckend graue Ebene,
 * ohne dass etwas rot wird. Er darf das sein, weil ein *geändertes* Wort auf keiner der
 * beiden Seiten unbemerkt bleibt: Rust pinnt seine Literale in
 * `karte::normalisierung::hochwasser_tests::bildet_die_hochwasserklassen_ab`, das
 * Frontend seine in `theme/statusFarben.test.ts`. Ungedeckt bleibt allein eine NEUE
 * Klasse, die nur eine Seite bekommt — wer eine einführt, fasst beide Pins an.
 */
function alsKlasse(roh: unknown): HochwasserKlasse {
  // Eigene Schlüssel, nicht `in`: das sähe auch `constructor`/`toString` aus der
  // Prototypkette. `Object.hasOwn` scheidet wegen `lib: ES2020` aus.
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
