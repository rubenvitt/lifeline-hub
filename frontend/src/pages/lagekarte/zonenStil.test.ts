import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import { gefahrengebietStil, zoneStil, zonenBeschriftung, ZONE_TYPEN } from './zonenStil';
import { rollenFarbe, warnstufeKarte } from '../../theme/statusFarben';
import type { Warnstufe } from '../../api/types';

/** Reine Ableitung ohne Render — Erwartung und Code lesen denselben Token, geprüft wird
 *  die ROLLE, nicht der Wert. */
const token = theme.getDesignToken();

describe('zoneStil', () => {
  it('leitet roten Stil für gefahrengebiet ab (gespeicherte Farbe wird ignoriert)', () => {
    const s = zoneStil('gefahrengebiet', '#abcdef');
    expect(s.fillColor).toBe('#cf1322');
    expect(s.lineColor).toBe('#cf1322');
    expect(s.fillOpacity).toBeGreaterThan(0);
  });

  it('absperrgrenze ist eine kräftige Linie ohne Füllung', () => {
    const s = zoneStil('absperrgrenze', null);
    expect(s.fillOpacity).toBe(0);
    expect(s.lineWidth).toBeGreaterThanOrEqual(3);
  });

  it('freie_skizze nutzt die gespeicherte Farbe (Fallback bei leer)', () => {
    expect(zoneStil('freie_skizze', '#00ff00').fillColor).toBe('#00ff00');
    expect(zoneStil('freie_skizze', null).fillColor).toBe('#1677ff');
  });

  // LFH-328/A2: die fünfstufige Warnstufen-Skala lag als `WARNSTUFE_KARTE` mit eigenen Hex-
  // Werten hier und steht jetzt als `warnstufeKarte` im Statusfarb-Vertrag. Geprüft wird die
  // Herkunft (Rolle), nicht ein Farbwert — sonst wäre die Skala nur umgezogen, nicht gebunden.
  it('zieht die Gefahrengebiet-Farbe aus dem Statusfarb-Vertrag, nicht aus einem Literal', () => {
    expect(gefahrengebietStil('akut', token).fillColor).toBe(rollenFarbe('alarm', token));
    expect(gefahrengebietStil('mittel', token).fillColor).toBe(rollenFarbe('achtung', token));
    // `keine` bleibt Alarm: ein unbewertetes Gefahrengebiet wird vorsichtshalber als Gefahr
    // gezeigt, nicht „ruhiger" als `niedrig` (Begründung in statusFarben.ts).
    expect(gefahrengebietStil('keine', token).fillColor).toBe(rollenFarbe('alarm', token));
    expect(gefahrengebietStil('keine', token).fillColor).not.toBe(
      gefahrengebietStil('niedrig', token).fillColor,
    );
    // Füllung und Linie tragen dieselbe Farbe — die Signatur bleibt einkanalig lesbar.
    const s = gefahrengebietStil('hoch', token);
    expect(s.lineColor).toBe(s.fillColor);
    expect(s.fillOpacity).toBeGreaterThan(0);
  });

  it('deckt jede Warnstufe ab — eine neue Variante bleibt nicht farblos', () => {
    for (const stufe of Object.keys(warnstufeKarte) as (keyof typeof warnstufeKarte)[]) {
      expect(gefahrengebietStil(stufe, token).fillColor, stufe).toBeTruthy();
    }
  });

  it('Katalog: nur freie_skizze erlaubt beide Geometrien', () => {
    const freie = ZONE_TYPEN.find((t) => t.typ === 'freie_skizze')!;
    expect(freie.geometrie).toBe('beides');
    expect(ZONE_TYPEN.find((t) => t.typ === 'absperrgrenze')!.geometrie).toBe('LineString');
    expect(ZONE_TYPEN.find((t) => t.typ === 'gefahrengebiet')!.geometrie).toBe('Polygon');
  });
});

// LFH-357: die Farbe allein trägt die Skala NICHT — fünf Stufen fallen auf zwei Rollen
// (`achtung`: niedrig/mittel, `alarm`: keine/hoch/akut). Der zweite Kanal auf der Kartenfläche
// ist der Beschriftungstext; A2 hatte dafür `label` ODER `form` genannt, beide standen dort nicht
// zur Verfügung. Diese Tests sind die Zusicherung, dass der Text sie jetzt wirklich auflöst.
describe('zonenBeschriftung', () => {
  const ALLE = Object.keys(warnstufeKarte) as Warnstufe[];

  it('macht alle fünf Warnstufen am Text unterscheidbar', () => {
    const texte = ALLE.map((s) => zonenBeschriftung('Werkshalle Nord', s));
    expect(texte).toHaveLength(5);
    // Paarweise verschieden — genau das, was die Farbachse nicht leisten kann.
    expect(new Set(texte).size).toBe(5);
  });

  it('trennt `keine` von `akut`, obwohl beide auf der Rolle alarm liegen', () => {
    const token = theme.getDesignToken();
    // Vorbedingung: die Farbe ist hier tatsächlich gleich — sonst prüfte der Test nichts.
    expect(gefahrengebietStil('keine', token).lineColor).toBe(
      gefahrengebietStil('akut', token).lineColor,
    );
    expect(zonenBeschriftung('Werk', 'keine')).not.toBe(zonenBeschriftung('Werk', 'akut'));
  });

  it('nimmt den Wortlaut aus dem Statusfarb-Vertrag, nicht aus einem eigenen Literal', () => {
    for (const stufe of ALLE) {
      expect(zonenBeschriftung(null, stufe), stufe).toContain(warnstufeKarte[stufe].label);
    }
  });

  it('stellt die Stufe unter den Zonennamen; ohne Namen steht sie allein', () => {
    expect(zonenBeschriftung('Werkshalle Nord', 'hoch')).toBe('Werkshalle Nord\nWarnstufe: hoch');
    expect(zonenBeschriftung(null, 'hoch')).toBe('Warnstufe: hoch');
    // Ein Name aus lauter Leerzeichen ist kein Name — sonst stünde die Stufe in Zeile zwei
    // unter einer leeren Zeile eins.
    expect(zonenBeschriftung('   ', 'hoch')).toBe('Warnstufe: hoch');
  });

  it('lässt Zonen ohne Warnstufe unverändert — die Stufe gehört nur ans Gefahrengebiet', () => {
    expect(zonenBeschriftung('Absperrung Süd', null)).toBe('Absperrung Süd');
    expect(zonenBeschriftung(null, null)).toBe('');
  });
});
