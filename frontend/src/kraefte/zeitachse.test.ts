import { describe, expect, it } from 'vitest';
import type { Einsatzperiode, SchichtplanGrenzwerte, ZeitachseEreignis } from '../api/types';
import {
  abschliessendeEntlassungId,
  ankerText,
  dauerText,
  einstufungText,
  EINSTUFUNG_WORT,
  HERKUNFT_WORT,
  kraftDauern,
  NACHTRAG_ARTEN,
  stufeEin,
} from './zeitachse';

/** UTC-Millisekunden eines Wirestrings des 30.09.2026. */
function um(uhr: string): number {
  return Date.parse(`2026-09-30T${uhr}:00Z`);
}
function w(uhr: string): string {
  return `2026-09-30 ${uhr}:00`;
}

describe('kraftDauern (Spec „Einsatzdauer und Ruhezeit")', () => {
  it('„Laufende Einsatzdauer": Anker Alarmierung, 7 h 40', () => {
    const p: Einsatzperiode[] = [
      { beginn_at: w('06:10'), anker: 'alarmierung', eintreffen_at: w('06:40') },
    ];
    const d = kraftDauern(p, um('13:50'));
    expect(d.laufend).toEqual({ minuten: 460, anker: 'alarmierung', beginnAt: w('06:10') });
    expect(dauerText(d.laufend!.minuten)).toBe('7 h 40');
    expect(d.gesamtMinuten).toBe(460);
    expect(d.ruheMinuten).toBeNull();
  });

  it('„Ruhezeit": 3 h 20 nach dem Ende, keine laufende Dauer', () => {
    const p: Einsatzperiode[] = [
      { beginn_at: w('06:40'), anker: 'eintreffen', ende_at: w('14:40'), ende_art: 'abloesung' },
    ];
    const d = kraftDauern(p, um('18:00'));
    expect(d.laufend).toBeNull();
    expect(d.ruheMinuten).toBe(200);
    expect(dauerText(d.ruheMinuten!)).toBe('3 h 20');
    expect(d.gesamtMinuten).toBe(480);
  });

  it('„Keine Ereignisse": alles fehlt, nie 0', () => {
    expect(kraftDauern([], um('12:00'))).toEqual({
      laufend: null,
      gesamtMinuten: null,
      ruheMinuten: null,
    });
    expect(kraftDauern(undefined, um('12:00')).gesamtMinuten).toBeNull();
  });

  it('Gesamtzeit summiert beendete und offene Periode', () => {
    const p: Einsatzperiode[] = [
      { beginn_at: w('06:00'), anker: 'alarmierung', ende_at: w('08:00') },
      { beginn_at: w('10:00'), anker: 'eintreffen' },
    ];
    const d = kraftDauern(p, um('10:30'));
    expect(d.gesamtMinuten).toBe(150);
    expect(d.laufend?.minuten).toBe(30);
    expect(d.ruheMinuten).toBeNull();
  });

  it('liest UTC, nicht Ortszeit', () => {
    const p: Einsatzperiode[] = [{ beginn_at: w('06:00'), anker: 'eintreffen' }];
    expect(kraftDauern(p, um('07:00')).laufend?.minuten).toBe(60);
  });
});

describe('dauerText', () => {
  it('unter einer Stunde in Minuten, sonst Stunden mit zweistelligen Minuten', () => {
    expect(dauerText(0)).toBe('0 min');
    expect(dauerText(40)).toBe('40 min');
    expect(dauerText(60)).toBe('1 h 00');
    expect(dauerText(1865)).toBe('31 h 05');
  });
});

describe('Wörter', () => {
  it('Anker und Herkunft sind lesbar', () => {
    expect(ankerText('alarmierung', '06:10')).toBe('seit Alarmierung 06:10');
    expect(HERKUNFT_WORT.einheit).toBe('über Einheit');
    expect(HERKUNFT_WORT.nachtrag).toBe('nachgetragen');
    expect(HERKUNFT_WORT.disposition).toBe('aus dem Einsatz entlassen');
    expect(HERKUNFT_WORT.bereitstellungsraum).toBe('am Bereitstellungsraum');
  });

  it('Ablösung lässt sich nicht nachtragen', () => {
    expect(NACHTRAG_ARTEN).not.toContain('abloesung');
  });
});

describe('abschliessendeEntlassungId (LLH-1263, Spec „Abschließende Entlassung streichen“)', () => {
  function ereignis(
    id: number,
    art: ZeitachseEreignis['art'],
    uhr: string,
    gestrichen = false,
  ): ZeitachseEreignis {
    return {
      id,
      art,
      zeitpunkt_at: w(uhr),
      quelle: 'nachtrag',
      erfasst_at: w(uhr),
      erfasst_von: 1,
      gestrichen_at: gestrichen ? w('15:00') : null,
    };
  }
  const geschlossen: Einsatzperiode[] = [
    {
      beginn_at: w('06:10'),
      anker: 'alarmierung',
      eintreffen_at: w('06:40'),
      ende_at: w('14:00'),
      ende_art: 'entlassung',
    },
  ];
  const ereignisse = [
    ereignis(1, 'alarmierung', '06:10'),
    ereignis(2, 'eintreffen', '06:40'),
    ereignis(3, 'entlassung', '12:00', true),
    ereignis(4, 'entlassung', '14:00'),
  ];

  it('nennt die nicht gestrichene Entlassung, die die letzte Periode schließt', () => {
    expect(abschliessendeEntlassungId(geschlossen, ereignisse)).toBe(4);
  });

  it('bei zwei Entlassungen in derselben Sekunde die spätere (Reihenfolge der Erfassung)', () => {
    const zweiPerioden: Einsatzperiode[] = [
      { ...geschlossen[0] },
      {
        beginn_at: w('14:00'),
        anker: 'alarmierung',
        ende_at: w('14:00'),
        ende_art: 'entlassung',
      },
    ];
    expect(
      abschliessendeEntlassungId(zweiPerioden, [
        ...ereignisse,
        ereignis(6, 'alarmierung', '14:00'),
        ereignis(7, 'entlassung', '14:00'),
      ]),
    ).toBe(7);
  });

  it('keine bei offener letzter Periode', () => {
    const offen: Einsatzperiode[] = [
      ...geschlossen,
      { beginn_at: w('15:00'), anker: 'eintreffen', eintreffen_at: w('15:00') },
    ];
    expect(abschliessendeEntlassungId(offen, ereignisse)).toBeNull();
  });

  it('keine, wenn eine Ablösung die letzte Periode schließt', () => {
    const abgeloest: Einsatzperiode[] = [{ ...geschlossen[0], ende_art: 'abloesung' }];
    expect(
      abschliessendeEntlassungId(abgeloest, [
        ...ereignisse.slice(0, 2),
        ereignis(5, 'abloesung', '14:00'),
      ]),
    ).toBeNull();
  });

  it('keine ohne Perioden', () => {
    expect(abschliessendeEntlassungId([], [])).toBeNull();
    expect(abschliessendeEntlassungId(undefined, undefined)).toBeNull();
  });
});

describe('stufeEin (Spec „Einstufung gegen die Grenzwerte des Einsatzes", LLH-730)', () => {
  // Vorgaben des Schichtplans: 12 h Höchstdienst, 8 h Mindestruhe.
  const VORGABE: SchichtplanGrenzwerte = {
    max_dienst_minuten: 720,
    min_ruhe_minuten: 480,
    max_dienst_eigen: false,
    min_ruhe_eigen: false,
  };
  const offen = (beginn: string): Einsatzperiode => ({
    beginn_at: w(beginn),
    anker: 'alarmierung',
  });
  const zu = (beginn: string, ende: string): Einsatzperiode => ({
    beginn_at: w(beginn),
    anker: 'alarmierung',
    ende_at: w(ende),
    ende_art: 'entlassung',
  });

  it('„Zu lang in einer Periode": 12 h 20 seit 06:10', () => {
    expect(stufeEin([offen('06:10')], VORGABE, um('18:30'))).toEqual({
      wort: 'zu_lang',
      streckeBeginnAt: w('06:10'),
      streckeMinuten: 740,
      ruheMinuten: null,
    });
  });

  it('„Genau am Höchstwert": 12 h 00 bleibt ohne Einstufung (streng wie der Plan)', () => {
    expect(stufeEin([offen('06:10')], VORGABE, um('18:10'))).toBeNull();
  });

  it('„Kurze Pause trennt die Strecke nicht": 08–14 und ab 16:00 um 22:30 → zu lang, Strecke ab 08:00', () => {
    // Gleiche Zahlen wie der Plan-Befund „Zu lange ohne Ruhe" (`pruefung.rs`).
    expect(stufeEin([zu('08:00', '14:00'), offen('16:00')], VORGABE, um('22:30'))).toEqual({
      wort: 'zu_lang',
      streckeBeginnAt: w('08:00'),
      streckeMinuten: 870,
      ruheMinuten: 120,
    });
  });

  it('„Ruhe zu kurz": dieselben Perioden um 17:00, 2 h Ruhe', () => {
    expect(stufeEin([zu('08:00', '14:00'), offen('16:00')], VORGABE, um('17:00'))).toEqual({
      wort: 'ruhe_zu_kurz',
      streckeBeginnAt: w('08:00'),
      streckeMinuten: 540,
      ruheMinuten: 120,
    });
  });

  it('„Genug Ruhe": 06–12 und ab 20:00 → keine Einstufung, die Strecke beginnt neu', () => {
    expect(stufeEin([zu('06:00', '12:00'), offen('20:00')], VORGABE, um('23:00'))).toBeNull();
  });

  it('Lücke 0 ist durchgehender Dienst, keine „Ruhe zu kurz"', () => {
    expect(stufeEin([zu('08:00', '12:00'), offen('12:00')], VORGABE, um('13:00'))).toBeNull();
    // … zählt aber zur Strecke.
    expect(stufeEin([zu('08:00', '12:00'), offen('12:00')], VORGABE, um('20:30'))?.wort).toBe(
      'zu_lang',
    );
  });

  it('Mindestruhe 0: keine Lücke ist zu kurz, jede echte Lücke trennt', () => {
    const g = { ...VORGABE, min_ruhe_minuten: 0, min_ruhe_eigen: true };
    expect(stufeEin([zu('06:00', '14:00'), offen('14:01')], g, um('20:00'))).toBeNull();
    // Lücke 0 trennt auch bei Mindestruhe 0 nicht (wie `pruefung.rs`: `luecke > 0`).
    expect(stufeEin([zu('06:00', '14:00'), offen('14:00')], g, um('20:30'))?.wort).toBe('zu_lang');
  });

  it('„Eigener Wert des Einsatzes": 6 h → 6 h 20 ist zu lang', () => {
    const g = { ...VORGABE, max_dienst_minuten: 360, max_dienst_eigen: true };
    expect(stufeEin([offen('06:10')], g, um('12:30'))?.wort).toBe('zu_lang');
  });

  it('„Ohne offene Periode": keine Einstufung, auch nach 13 h Dienst', () => {
    expect(stufeEin([zu('06:00', '19:00')], VORGABE, um('20:00'))).toBeNull();
  });

  it('„Ohne Ereignis" und „Grenzwerte nicht geladen": keine Einstufung', () => {
    expect(stufeEin([], VORGABE, um('20:00'))).toBeNull();
    expect(stufeEin(undefined, VORGABE, um('20:00'))).toBeNull();
    expect(stufeEin([offen('06:00')], undefined, um('20:00'))).toBeNull();
  });

  it('ordnet Perioden nach Beginn, auch wenn sie anders kommen', () => {
    expect(stufeEin([offen('16:00'), zu('08:00', '14:00')], VORGABE, um('17:00'))?.wort).toBe(
      'ruhe_zu_kurz',
    );
  });
});

describe('einstufungText', () => {
  const VORGABE: SchichtplanGrenzwerte = {
    max_dienst_minuten: 720,
    min_ruhe_minuten: 480,
    max_dienst_eigen: false,
    min_ruhe_eigen: false,
  };
  const zeit = (utc: string) => utc.slice(11, 16);

  it('nennt Wort, Strecke, Höchstwert und die kurze Ruhe', () => {
    expect(EINSTUFUNG_WORT.zu_lang).toBe('zu lang');
    expect(EINSTUFUNG_WORT.ruhe_zu_kurz).toBe('Ruhe zu kurz');
    expect(
      einstufungText(
        {
          wort: 'zu_lang',
          streckeBeginnAt: w('08:00'),
          streckeMinuten: 870,
          ruheMinuten: 120,
        },
        VORGABE,
        zeit,
      ),
    ).toBe('Im Dienst seit 08:00: 14 h 30, Höchstwert 12 h · Ruhe davor 2 h 00, Mindestruhe 8 h');
    expect(
      einstufungText(
        { wort: 'zu_lang', streckeBeginnAt: w('06:10'), streckeMinuten: 740, ruheMinuten: null },
        VORGABE,
        zeit,
      ),
    ).toBe('Im Dienst seit 06:10: 12 h 20, Höchstwert 12 h');
  });

  it('nennt nach durchgehendem Dienst (Lücke 0) keine Ruhe', () => {
    expect(
      einstufungText(
        { wort: 'zu_lang', streckeBeginnAt: w('08:00'), streckeMinuten: 750, ruheMinuten: 0 },
        VORGABE,
        zeit,
      ),
    ).toBe('Im Dienst seit 08:00: 12 h 30, Höchstwert 12 h');
  });

  it('„Ruhe zu kurz" nennt zuerst die Ruhe', () => {
    expect(
      einstufungText(
        {
          wort: 'ruhe_zu_kurz',
          streckeBeginnAt: w('08:00'),
          streckeMinuten: 540,
          ruheMinuten: 120,
        },
        { ...VORGABE, min_ruhe_minuten: 450 },
        zeit,
      ),
    ).toBe('Ruhe davor 2 h 00, Mindestruhe 7:30 h · Im Dienst seit 08:00: 9 h 00, Höchstwert 12 h');
  });
});
