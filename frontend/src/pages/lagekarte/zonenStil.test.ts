import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import { gefahrengebietStil, zoneStil, ZONE_TYPEN } from './zonenStil';
import { rollenFarbe, warnstufeKarte } from '../../theme/statusFarben';

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
