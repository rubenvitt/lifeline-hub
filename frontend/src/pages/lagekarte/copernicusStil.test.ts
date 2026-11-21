import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import {
  isCopernicusAufnahmeAlt,
  copernicusBreite,
  copernicusDarstellung,
  copernicusRadius,
  faerbeCopernicus,
} from './copernicusStil';
import { antdToken, farbenHell } from '../../theme/tokens';
import { copernicusKlasse, rollenFarbe } from '../../theme/statusFarben';
import type { FeatureCollection } from '../../api/fachebenen';

const hell = theme.getDesignToken({
  algorithm: theme.defaultAlgorithm,
  token: antdToken(farbenHell),
});

function fc(klassen: (string | undefined)[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: klassen.map((klasse, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [9 + i, 48.8] },
      properties: klasse === undefined ? { emsr: 'EMSR728' } : { emsr: 'EMSR728', klasse },
    })),
  } as FeatureCollection;
}

describe('copernicusStil (LLH-1200)', () => {
  it('staffelt Schäden in Punktgröße und Linienbreite streng monoton', () => {
    // Zweiter Kanal neben der Rolle: „beschädigt“ und „zerstört“ teilen sich `alarm`.
    const stufen = ['kein_schaden', 'schaden_moeglich', 'beschaedigt', 'zerstoert'] as const;
    for (let i = 1; i < stufen.length; i++) {
      expect(copernicusRadius(stufen[i])).toBeGreaterThan(copernicusRadius(stufen[i - 1]));
      expect(copernicusBreite(stufen[i])).toBeGreaterThan(copernicusBreite(stufen[i - 1]));
    }
  });

  it('backt Rollenfarbe, Radius und Breite ein und lässt die übrigen Properties stehen', () => {
    const [f] = faerbeCopernicus(fc(['zerstoert']), hell).features;
    expect(f.properties).toMatchObject({
      emsr: 'EMSR728',
      klasse: 'zerstoert',
      farbe: rollenFarbe('alarm', hell),
      radius: copernicusRadius('zerstoert'),
      breite: copernicusBreite('zerstoert'),
    });
  });

  it('macht Unbekanntes und Fehlendes zu „Klasse unbekannt“, statt den Rohwert zu zeigen', () => {
    expect(copernicusDarstellung('xyz')).toBe(copernicusKlasse.unbekannt);
    expect(copernicusDarstellung(undefined)).toBe(copernicusKlasse.unbekannt);
    expect(copernicusDarstellung('constructor')).toBe(copernicusKlasse.unbekannt);
    const [f] = faerbeCopernicus(fc([undefined]), hell).features;
    expect(f.properties?.farbe).toBe(rollenFarbe('neutral', hell));
  });

  it('liest bekannte Klassen aus dem Vertrag', () => {
    expect(copernicusDarstellung('tiefe_hoch')).toBe(copernicusKlasse.tiefe_hoch);
    expect(copernicusDarstellung('gebiet')).toBe(copernicusKlasse.gebiet);
  });
});

describe('isCopernicusAufnahmeAlt (LLH-1200)', () => {
  const jetzt = Date.UTC(2026, 10, 21, 12, 0, 0);
  it('gilt ab mehr als 24 h als alt, genau 24 h noch nicht', () => {
    expect(isCopernicusAufnahmeAlt('2026-11-20 12:00:00', jetzt)).toBe(false);
    expect(isCopernicusAufnahmeAlt('2026-11-20 11:59:59', jetzt)).toBe(true);
    expect(isCopernicusAufnahmeAlt('2026-11-21 11:00:00', jetzt)).toBe(false);
  });
  it('sagt ohne lesbare Aufnahme nichts', () => {
    expect(isCopernicusAufnahmeAlt(undefined, jetzt)).toBe(false);
    expect(isCopernicusAufnahmeAlt('gestern', jetzt)).toBe(false);
  });
});
