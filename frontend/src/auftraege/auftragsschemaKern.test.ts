import { describe, expect, it } from 'vitest';
import {
  AUSFUEHRUNG_FIELDS,
  FORM_LABEL,
  KLAPPTEIL,
  READ_LABEL,
  READ_ORDER,
  WEITERE_FIELDS,
  klappteilFuer,
} from './auftragsschemaKern';

describe('Auftragsschema nach FwDV 100 (LLH-1091)', () => {
  it('ordnet die Ausführung als Mittel, Ziel, Weg, Zeit', () => {
    expect(AUSFUEHRUNG_FIELDS).toEqual(['mittel', 'ort', 'weg', 'zeit']);
    expect(AUSFUEHRUNG_FIELDS.map((f) => FORM_LABEL[f])).toEqual([
      'Mittel / Womit',
      'Ziel / Ort',
      'Weg',
      'Zeit / Wann',
    ]);
  });

  it('führt Lage, Absicht, Verbindung, Sicherheit, Richtung und Erteilzeit unter den weiteren Angaben', () => {
    expect(WEITERE_FIELDS).toEqual([
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
    expect(READ_ORDER).toEqual([
      'mittel',
      'ort',
      'weg',
      'zeit',
      'lage',
      'absicht',
      'verbindung',
      'sicherheit',
    ]);
    expect(READ_ORDER.map((f) => READ_LABEL[f])).toEqual([
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
    for (const f of AUSFUEHRUNG_FIELDS) expect(klappteilFuer(f)).toBe(KLAPPTEIL.ausfuehrung);
    for (const f of WEITERE_FIELDS) expect(klappteilFuer(f)).toBe(KLAPPTEIL.weitere);
    for (const f of ['empfaenger', 'text', 'prioritaet', 'frist']) {
      expect(klappteilFuer(f)).toBeNull();
    }
    const alle = [...AUSFUEHRUNG_FIELDS, ...WEITERE_FIELDS];
    expect(new Set(alle).size).toBe(alle.length);
  });
});
