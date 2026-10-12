import { describe, expect, it } from 'vitest';
import {
  AUSFUEHRUNG_FIELDS,
  FORM_LABEL,
  KLAPPTEIL,
  READ_LABEL,
  READ_ORDER,
  WEITERE_FIELDS,
  druckFelder,
  klappteilFuer,
} from './auftragsschemaKern';
import { druckAuftrag, druckEmpfaenger } from './auftragDruckTestdaten';

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

/** Zeiten im Test sichtbar markiert: belegt, dass jede Zeit über die Anzeigezone läuft. */
const fmt = (wire?: string | null) => (wire ? `Z(${wire})` : '');

describe('Feldfolge des Auftragsblatts (LLH-1171, Spec `druck-dokumente`)', () => {
  it('teilweise gefüllter Auftrag: genau diese Etiketten in dieser Folge, leere fallen weg', () => {
    const felder = druckFelder(druckAuftrag(), fmt);
    expect(felder.map((f) => f.etikett)).toEqual([
      'Empfänger',
      'Auftrag',
      'Priorität',
      'Mittel',
      'Weg',
      'Absicht',
      'Richtung',
      'Erteilt am',
    ]);
    const wert = (e: string) => felder.find((f) => f.etikett === e)?.wert;
    expect(wert('Empfänger')).toBe('2. Zug, Logistiktrupp');
    expect(wert('Priorität')).toBe('Dringend');
    expect(wert('Richtung')).toBe('Intern');
    expect(wert('Erteilt am')).toBe('Z(2026-06-11 08:13:00)');
  });

  it('voll gefüllter Auftrag: Kopf, dann die Lesefolge der Karte, dann Richtung und Erteilzeit', () => {
    const felder = druckFelder(
      druckAuftrag({
        frist_at: '2026-06-11 09:00:00',
        lage: 'L',
        ort: 'O',
        zeit: 'Z',
        verbindung: 'V',
        sicherheit: 'S',
      }),
      fmt,
    );
    const etiketten = felder.map((f) => f.etikett);
    expect(etiketten.slice(0, 4)).toEqual(['Empfänger', 'Auftrag', 'Priorität', 'Frist']);
    // Die Lesefolge der Karte steht als zusammenhängende Teilfolge im Blatt: wer sie umstellt,
    // stellt beide um, und eine eigene Liste des Blatts fiele hier auf.
    expect(etiketten.slice(4, 4 + READ_ORDER.length)).toEqual(READ_ORDER.map((f) => READ_LABEL[f]));
    expect(etiketten.slice(4 + READ_ORDER.length)).toEqual(['Richtung', 'Erteilt am']);
    expect(felder.find((f) => f.etikett === 'Frist')?.wert).toBe('Z(2026-06-11 09:00:00)');
  });

  it('Empfänger tragen die aktuelle Besetzung wie Karte und Detail', () => {
    const a = druckAuftrag({
      empfaenger: [
        druckEmpfaenger(1, 'S4', null, {
          aktuelle_besetzung: { zustand: 'personal', name: 'Meier' } as never,
        }),
      ],
    });
    expect(druckFelder(a, fmt)[0]).toEqual({ etikett: 'Empfänger', wert: 'S4 · Meier' });
  });

  it('externer Auftrag: die Richtung nennt „Extern“ und die externe Stelle', () => {
    const a = druckAuftrag({
      richtung: 'extern',
      empfaenger: [
        druckEmpfaenger(9, 'Polizei', null, {
          empfaenger_typ: 'extern',
          abschnitt_id: null,
          extern_kategorie: 'andere_bos',
          extern_bezeichnung: 'Polizei',
        }),
      ],
    });
    expect(druckFelder(a, fmt).find((f) => f.etikett === 'Richtung')?.wert).toBe(
      'Extern · Andere BOS: Polizei',
    );
  });

  it('ein Feld aus Leerzeichen fällt weg wie ein leeres', () => {
    const felder = druckFelder(druckAuftrag({ lage: '   ' }), fmt);
    expect(felder.map((f) => f.etikett)).not.toContain('Lage');
  });
});
