import type { GlobalToken } from 'antd';
import { luftqualitaetIndex, rollenFarbe, type StatusDarstellung } from '../../theme/statusFarben';
import type { FeatureCollection, LuftqualitaetKlasse } from '../../api/fachebenen';

/**
 * Darstellung der UBA-Luftqualitätsebene: Rollenfarbe und Punktdurchmesser je Indexstufe, in die
 * Feature-Properties eingebacken — wie `hochwasserStil.ts`, weil die Farbe aus dem aufgelösten
 * Token kommt und die Kartenstil-Module keinen `useToken()`-Zugang haben.
 *
 * Der Radius ist der zweite Kanal: `luftqualitaetIndex` legt fünf Stufen auf drei Rollen, ohne
 * streng monotonen Durchmesser wären „sehr gut"/„gut" bzw. „schlecht"/„sehr schlecht" nicht zu
 * trennen. Der Sprung zwischen `maessig` und `schlecht` ist größer: dort wechselt die Rolle zu
 * Alarm.
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
 * Unbekannter/fehlender Wert → „keine Daten": die Ebene erfindet keine Stufe. Ein geändertes
 * Wire-Wort bleibt nicht unbemerkt, weil beide Seiten ihre Literale pinnen
 * (`karte::luftqualitaet::tests` ↔ `theme/statusFarben.test.ts`).
 */
function alsKlasse(roh: unknown): LuftqualitaetKlasse {
  // Eigene Schlüssel, nicht `in` (sähe die Prototypkette). `Object.hasOwn` scheidet wegen `lib:
  // ES2020` aus.
  return typeof roh === 'string' && Object.prototype.hasOwnProperty.call(luftqualitaetIndex, roh)
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
