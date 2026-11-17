import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { wasBrennt, type WasBrenntQuellen } from './wasBrennt';

dayjs.extend(utc);

const JETZT = dayjs.utc('2026-11-16 14:10:00');

/** Ruhige Lage, alle Quellen geladen. */
function ruhig(): WasBrenntQuellen {
  return {
    meldungen: {
      zustand: 'daten',
      wert: { sofort_offen: 0, dringend_offen: 0, bestaetigung_ueberfaellig: 0 },
    },
    auftraege: { zustand: 'daten', wert: { ueberfaellig: 0 } },
    erinnerungen: { zustand: 'daten', wert: { faellig: 0 } },
    nachforderungen: { zustand: 'daten', wert: { ueberfaellig: 0 } },
    vermisst: { zustand: 'daten', wert: 0 },
    kritisch: { zustand: 'daten', wert: [] },
    rueckmeldung: { zustand: 'daten', wert: [] },
    ausfall: { zustand: 'daten', wert: [] },
  };
}

const texte = (q: WasBrenntQuellen) => wasBrennt(q, JETZT).eintraege.map((e) => e.text);

describe('wasBrennt (Spec lage-alarmzeile)', () => {
  it('ruhige Lage: keine Einträge, vollständig', () => {
    expect(wasBrennt(ruhig(), JETZT)).toEqual({
      eintraege: [],
      stand: 'vollstaendig',
      fehlend: [],
    });
  });

  it('vermisste Person steht in der Alarmrolle', () => {
    const q = { ...ruhig(), vermisst: { zustand: 'daten', wert: 1 } } as const;
    const [e] = wasBrennt(q, JETZT).eintraege;
    expect(e).toMatchObject({ art: 'vermisst', rolle: 'alarm', text: '1 vermisst' });
  });

  it('frische Sofortmeldung ab Eingang, mit Alter der ältesten', () => {
    const q: WasBrenntQuellen = {
      ...ruhig(),
      meldungen: {
        zustand: 'daten',
        wert: {
          sofort_offen: 1,
          sofort_aelteste_at: '2026-11-16 14:09:00',
          dringend_offen: 0,
          bestaetigung_ueberfaellig: 0,
        },
      },
    };
    expect(wasBrennt(q, JETZT).eintraege).toEqual([
      {
        art: 'sofort',
        rolle: 'alarm',
        text: '1 Sofortmeldung · älteste 1 min',
        voll: '1 Sofortmeldung · älteste 1 min',
        bezug: [],
      },
    ]);
  });

  it('Rückmeldung überfällig: längste zuerst, mit Dauer', () => {
    const q: WasBrenntQuellen = {
      ...ruhig(),
      rueckmeldung: {
        zustand: 'daten',
        wert: [
          { id: 2, name: 'Sanitätszug', seitMin: 12 },
          { id: 1, name: 'Logistiktrupp', seitMin: 47 },
        ],
      },
    };
    const [e] = wasBrennt(q, JETZT).eintraege;
    expect(e.text).toBe('Rückmeldung überfällig: Logistiktrupp, Sanitätszug · längste 47 min');
    expect(e.bezug).toEqual([1, 2]);
  });

  it('nennt lange Wartezeiten in Stunden und die erste Minute „< 1 min“ (LLH-1750)', () => {
    const mit = (seitMin: number): WasBrenntQuellen => ({
      ...ruhig(),
      rueckmeldung: { zustand: 'daten', wert: [{ id: 1, name: 'Logistiktrupp', seitMin }] },
    });
    expect(wasBrennt(mit(301), JETZT).eintraege[0].text).toMatch(/· längste 5 h 01 min$/);
    expect(wasBrennt(mit(1565), JETZT).eintraege[0].text).toMatch(/· längste 26 h 05 min$/);
    expect(wasBrennt(mit(0), JETZT).eintraege[0].text).toMatch(/· längste < 1 min$/);
  });

  it('höchstens zwei Namen, der Rest als „+n“, der volle Wortlaut nennt alle', () => {
    const q: WasBrenntQuellen = {
      ...ruhig(),
      ausfall: {
        zustand: 'daten',
        wert: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' },
        ],
      },
    };
    const [e] = wasBrennt(q, JETZT).eintraege;
    expect(e.text).toBe('Ausfall: A, B +1');
    expect(e.voll).toBe('Ausfall: A, B, C');
    expect(e.bezug).toEqual([1, 2, 3]);
  });

  it('kritischer Abschnitt mit Namen, Achtung-Arten in der Achtungsrolle', () => {
    const q: WasBrenntQuellen = {
      ...ruhig(),
      kritisch: { zustand: 'daten', wert: [{ id: 4, name: 'UHS Turnhalle' }] },
      erinnerungen: { zustand: 'daten', wert: { faellig: 1 } },
      nachforderungen: { zustand: 'daten', wert: { ueberfaellig: 2 } },
      meldungen: {
        zustand: 'daten',
        wert: { sofort_offen: 0, dringend_offen: 1, bestaetigung_ueberfaellig: 0 },
      },
    };
    expect(wasBrennt(q, JETZT).eintraege.map((e) => [e.text, e.rolle])).toEqual([
      ['kritisch: UHS Turnhalle', 'alarm'],
      ['1 dringend', 'achtung'],
      ['1 Erinnerung fällig', 'achtung'],
      ['2 Nachforderungen überfällig', 'achtung'],
    ]);
  });

  it('Rot vor Gelb: überfälliger Auftrag vor fälliger Erinnerung', () => {
    const q: WasBrenntQuellen = {
      ...ruhig(),
      erinnerungen: { zustand: 'daten', wert: { faellig: 1 } },
      auftraege: { zustand: 'daten', wert: { ueberfaellig: 1 } },
    };
    expect(texte(q)).toEqual(['1 Auftrag überfällig', '1 Erinnerung fällig']);
  });

  it('feste Folge in der Alarmrolle: Sofort, vermisst, Auftrag', () => {
    const q: WasBrenntQuellen = {
      ...ruhig(),
      auftraege: { zustand: 'daten', wert: { ueberfaellig: 2 } },
      vermisst: { zustand: 'daten', wert: 1 },
      meldungen: {
        zustand: 'daten',
        wert: { sofort_offen: 3, dringend_offen: 0, bestaetigung_ueberfaellig: 2 },
      },
    };
    expect(texte(q)).toEqual([
      '3 Sofortmeldungen',
      '2 Bestätigungen überfällig',
      '1 vermisst',
      '2 Aufträge überfällig',
    ]);
  });

  it('alle zehn Arten in der Folge der Spec', () => {
    const q: WasBrenntQuellen = {
      meldungen: {
        zustand: 'daten',
        wert: { sofort_offen: 1, dringend_offen: 1, bestaetigung_ueberfaellig: 1 },
      },
      auftraege: { zustand: 'daten', wert: { ueberfaellig: 1 } },
      erinnerungen: { zustand: 'daten', wert: { faellig: 1 } },
      nachforderungen: { zustand: 'daten', wert: { ueberfaellig: 1 } },
      vermisst: { zustand: 'daten', wert: 1 },
      kritisch: { zustand: 'daten', wert: [{ id: 1, name: 'EA' }] },
      rueckmeldung: { zustand: 'daten', wert: [{ id: 1, name: 'T', seitMin: 5 }] },
      ausfall: { zustand: 'daten', wert: [{ id: 1, name: 'T' }] },
    };
    expect(wasBrennt(q, JETZT).eintraege.map((e) => e.art)).toEqual([
      'sofort',
      'bestaetigung',
      'vermisst',
      'kritisch',
      'rueckmeldung',
      'ausfall',
      'auftrag',
      'dringend',
      'erinnerung',
      'nachforderung',
    ]);
  });

  it('gescheiterte Quelle: unvollständig, nie Ruhe', () => {
    const q: WasBrenntQuellen = { ...ruhig(), rueckmeldung: { zustand: 'fehler' } };
    expect(wasBrennt(q, JETZT)).toEqual({
      eintraege: [],
      stand: 'unvollstaendig',
      fehlend: ['Rückmeldungen'],
    });
  });

  it('ladende Quelle: lädt', () => {
    const q: WasBrenntQuellen = { ...ruhig(), meldungen: { zustand: 'laden' } };
    expect(wasBrennt(q, JETZT).stand).toBe('laedt');
  });

  it('nicht erlaubtes Modul: weggelassen, Stand vollständig', () => {
    const q: WasBrenntQuellen = {
      ...ruhig(),
      auftraege: { zustand: 'gesperrt' },
      meldungen: { zustand: 'gesperrt' },
    };
    expect(wasBrennt(q, JETZT)).toEqual({ eintraege: [], stand: 'vollstaendig', fehlend: [] });
  });

  it('Quelle, die es nicht gibt (Monitor ohne Ausfall), zählt nicht als unvollständig', () => {
    const q: WasBrenntQuellen = { ...ruhig(), ausfall: null };
    expect(wasBrennt(q, JETZT).stand).toBe('vollstaendig');
  });
});
