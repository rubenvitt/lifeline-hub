import type { GlobalToken } from 'antd';
import { copernicusKlasse, rollenFarbe, type StatusDarstellung } from '../../theme/statusFarben';
import type { CopernicusKlasse, FeatureCollection } from '../../api/fachebenen';

/**
 * Darstellung der Copernicus-Ebene (LLH-1200): Rollenfarbe je Klasse, dazu Punktgröße für
 * Gebäudepunkte und Linienbreite für Straßen, in die Feature-Properties eingebacken wie bei
 * `hochwasserStil.ts`. Flächen tragen die Farbe allein; ihr zweiter Kanal ist das Wort im
 * Inspector und die Legende.
 *
 * Größe und Breite sind der zweite Kanal für Schäden: „beschädigt“ und „zerstört“ teilen sich
 * `alarm` (WCAG 1.4.1).
 */
const RADIUS: Record<CopernicusKlasse, number> = {
  gebiet: 3,
  nicht_ausgewertet: 3,
  beobachtet: 4,
  max_ausdehnung: 4,
  tiefe_gering: 4,
  tiefe_mittel: 4,
  tiefe_hoch: 4,
  unbekannt: 3,
  kein_schaden: 3,
  schaden_moeglich: 4,
  beschaedigt: 6,
  zerstoert: 8,
};

const BREITE: Record<CopernicusKlasse, number> = {
  gebiet: 1.5,
  nicht_ausgewertet: 1.5,
  beobachtet: 2,
  max_ausdehnung: 2,
  tiefe_gering: 2,
  tiefe_mittel: 2,
  tiefe_hoch: 2,
  unbekannt: 1.5,
  kein_schaden: 1.5,
  schaden_moeglich: 2.5,
  beschaedigt: 3.5,
  zerstoert: 5,
};

/** Unbekannter oder fehlender Wert → `unbekannt`; die Ebene erfindet keine Klasse. */
function alsKlasse(roh: unknown): CopernicusKlasse {
  return typeof roh === 'string' && Object.prototype.hasOwnProperty.call(copernicusKlasse, roh)
    ? (roh as CopernicusKlasse)
    : 'unbekannt';
}

export function copernicusRadius(klasse: CopernicusKlasse): number {
  return RADIUS[klasse];
}

export function copernicusBreite(klasse: CopernicusKlasse): number {
  return BREITE[klasse];
}

/** Vertragsdarstellung (Rolle + Wort) zu einem rohen Klassenwert aus den Properties. */
export function copernicusDarstellung(roh: unknown): StatusDarstellung {
  return copernicusKlasse[alsKlasse(roh)];
}

/** Schreibt `farbe`, `radius` und `breite` je Feature; Geometrie und übrige Properties bleiben. */
export function faerbeCopernicus(fc: FeatureCollection, token: GlobalToken): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const klasse = alsKlasse(f.properties?.klasse);
      return {
        ...f,
        properties: {
          ...f.properties,
          farbe: rollenFarbe(copernicusKlasse[klasse].rolle, token),
          radius: RADIUS[klasse],
          breite: BREITE[klasse],
        },
      };
    }),
  };
}

/** Ab diesem Alter steht im Inspector die Warnung zur Aufnahme. */
const AUFNAHME_ALT_MS = 24 * 60 * 60_000;

/**
 * Ist die Aufnahme älter als 24 h? `aufnahme` ist UTC im Wire-Format `YYYY-MM-DD HH:MM:SS`
 * (ADR-0012). Ohne lesbare Aufnahme `false`: die Warnung erfindet kein Alter. Genau 24 h gelten
 * noch nicht als alt.
 */
export function isCopernicusAufnahmeAlt(
  aufnahme: string | null | undefined,
  jetzt: number,
): boolean {
  if (!aufnahme) return false;
  const t = Date.parse(`${aufnahme.replace(' ', 'T')}Z`);
  return Number.isFinite(t) && jetzt - t > AUFNAHME_ALT_MS;
}
