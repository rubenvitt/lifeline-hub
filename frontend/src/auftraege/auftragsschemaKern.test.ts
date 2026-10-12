import { describe, expect, it } from 'vitest';
import {
  AUSFUEHRUNG_FELDER,
  FORMULAR_ETIKETT,
  KLAPPTEIL,
  LESE_ETIKETT,
  LESEFOLGE,
  WEITERE_FELDER,
  klappteilFuer,
} from './auftragsschemaKern';

describe('Auftragsschema nach FwDV 100 (LLH-1091)', () => {
  it('ordnet die Ausführung als Mittel, Ziel, Weg, Zeit', () => {
    expect(AUSFUEHRUNG_FELDER).toEqual(['mittel', 'ort', 'weg', 'zeit']);
    expect(AUSFUEHRUNG_FELDER.map((f) => FORMULAR_ETIKETT[f])).toEqual([
      'Mittel / Womit',
      'Ziel / Ort',
      'Weg',
      'Zeit / Wann',
    ]);
  });

  it('führt Lage, Absicht, Verbindung, Sicherheit, Richtung und Erteilzeit unter den weiteren Angaben', () => {
    expect(WEITERE_FELDER).toEqual([
      'lage',
      'absicht',
      'verbindung',
      'sicherheit',
      'richtung',
      'erteiltAm',
      'externKategorie',
      'externBezeichnung',
    ]);
  });

  it('liest in Formularfolge: erst die Ausführung, dann die Schemafelder der weiteren Angaben', () => {
    expect(LESEFOLGE).toEqual([
      'mittel',
      'ort',
      'weg',
      'zeit',
      'lage',
      'absicht',
      'verbindung',
      'sicherheit',
    ]);
    expect(LESEFOLGE.map((f) => LESE_ETIKETT[f])).toEqual([
      'Mittel',
      'Ziel / Ort',
      'Weg',
      'Zeit',
      'Lage',
      'Absicht',
      'Verbindung / Meldewege',
      'Sicherheit / Besonderes',
    ]);
  });

  it('ordnet jedes Feld genau einem Klappteil zu, sichtbare Felder keinem', () => {
    for (const f of AUSFUEHRUNG_FELDER) expect(klappteilFuer(f)).toBe(KLAPPTEIL.ausfuehrung);
    for (const f of WEITERE_FELDER) expect(klappteilFuer(f)).toBe(KLAPPTEIL.weitere);
    for (const f of ['empfaenger', 'text', 'prioritaet', 'frist']) {
      expect(klappteilFuer(f)).toBeNull();
    }
    const alle = [...AUSFUEHRUNG_FELDER, ...WEITERE_FELDER];
    expect(new Set(alle).size).toBe(alle.length);
  });
});
