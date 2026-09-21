import type { GlobalToken } from 'antd';
import { luftqualitaetIndex, rollenFarbe, type StatusDarstellung } from '../../theme/statusFarben';
import type { FeatureCollection, LuftqualitaetKlasse } from '../../api/fachebenen';

/**
 * Darstellung der UBA-Luftqualitätsebene (LFH-79): Rollenfarbe und Punktdurchmesser je
 * Indexstufe, in die Feature-Properties eingebacken — dieselbe Arbeitsteilung wie
 * `hochwasserStil.ts` und aus demselben Grund: die Farbe kommt aus dem aufgelösten
 * antd-Token (Hell/Dunkel), die Kartenstil-Module haben keinen `useToken()`-Zugang
 * (LFH-328/A2). Der Circle-Layer liest `['get','farbe']`/`['get','radius']`.
 *
 * DER RADIUS IST DER ZWEITE KANAL, nicht Schmuck. `luftqualitaetIndex` legt fünf Stufen auf
 * drei Rollen; ohne den streng monotonen Durchmesser wären „sehr gut" und „gut" bzw.
 * „schlecht" und „sehr schlecht" auf der Karte nicht zu trennen (WCAG 1.4.1). Der Sprung
 * zwischen `maessig` und `schlecht` ist bewusst größer: dort wechselt die Rolle zu Alarm.
 */
const RADIUS: Record<LuftqualitaetKlasse, number> = {
  keine_daten: 3,
  sehr_gut: 4,
  gut: 5,
  maessig: 6,
  schlecht: 8,
  sehr_schlecht: 9,
};

/**
 * Unbekannter/fehlender Wert → „keine Daten": die Ebene erfindet keine Stufe. Der Rückfall
 * ist still; ein geändertes Wire-Wort bleibt trotzdem nicht unbemerkt, weil beide Seiten
 * ihre Literale pinnen (`karte::luftqualitaet::tests` ↔ `theme/statusFarben.test.ts`).
 */
function alsKlasse(roh: unknown): LuftqualitaetKlasse {
  return typeof roh === 'string' && roh in luftqualitaetIndex
    ? (roh as LuftqualitaetKlasse)
    : 'keine_daten';
}

export function luftqualitaetRadius(klasse: LuftqualitaetKlasse): number {
  return RADIUS[klasse];
}

/** Vertragsdarstellung (Rolle + Wort) zu einem rohen Stufenwert aus den Properties. */
export function luftqualitaetDarstellung(roh: unknown): StatusDarstellung {
  return luftqualitaetIndex[alsKlasse(roh)];
}

/** Schreibt `farbe` + `radius` je Feature; Geometrie und übrige Properties bleiben. */
export function faerbeLuftqualitaet(fc: FeatureCollection, token: GlobalToken): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const klasse = alsKlasse(f.properties?.klasse);
      return {
        ...f,
        properties: {
          ...f.properties,
          farbe: rollenFarbe(luftqualitaetIndex[klasse].rolle, token),
          radius: RADIUS[klasse],
        },
      };
    }),
  };
}
