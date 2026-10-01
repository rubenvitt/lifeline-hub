import { describe, expect, it } from 'vitest';
import type { WetterWarnstufe } from '../api/types';
import {
  UNWETTER_FENSTER_MS,
  erkenneNeue,
  naechsterUnwetterWechsel,
  paarSchluessel,
  unwetterHinweisText,
  unwetterLage,
  unwetterMarkenText,
  type UnwetterGedaechtnis,
} from './unwetter';

const BERLIN = { zeitzone: 'Europe/Berlin' };
/** 2026-09-22 12:30:00 UTC = 14:30 Berlin. */
const JETZT = Date.UTC(2026, 8, 22, 12, 30, 0);
const MIN = 60_000;
const STUNDE = 60 * MIN;
const um = (ms: number) => new Date(JETZT + ms).toISOString();

function warnung(stufe: WetterWarnstufe, ereignis: string, beginn = -STUNDE, ende = 2 * STUNDE) {
  return {
    stufe,
    ereignis,
    ueberschrift: `Amtliche WARNUNG vor ${ereignis}`,
    beginn: um(beginn),
    ende: um(ende),
  };
}

function teil(daten: ReturnType<typeof warnung>[], alter = 5 * MIN) {
  return { zustand: 'ok' as const, abgerufen_at: um(-alter), daten };
}

describe('unwetterLage', () => {
  it('zählt nur schwer und extrem, getrennt nach gilt jetzt und angekündigt', () => {
    const lage = unwetterLage(
      teil([
        warnung('schwer', 'SCHWERES GEWITTER'),
        warnung('extrem', 'EXTREME ORKANBÖEN', 2 * STUNDE, 5 * STUNDE),
        warnung('maessig', 'STURMBÖEN'),
        warnung('gering', 'FROST'),
      ]),
      JETZT,
    );
    expect(lage?.giltJetzt.map((w) => w.ereignis)).toEqual(['SCHWERES GEWITTER']);
    expect(lage?.angekuendigt.map((w) => w.ereignis)).toEqual(['EXTREME ORKANBÖEN']);
  });

  it('eine abgelaufene Warnung fällt heraus', () => {
    const lage = unwetterLage(teil([warnung('schwer', 'DAUERREGEN', -3 * STUNDE, -1)]), JETZT);
    expect(lage).toEqual({ giltJetzt: [], angekuendigt: [] });
  });

  it('ein veralteter Stand zählt noch', () => {
    const lage = unwetterLage(teil([warnung('schwer', 'DAUERREGEN')], 45 * MIN), JETZT);
    expect(lage?.giltJetzt).toHaveLength(1);
  });

  it('ohne verwertbaren Stand: null (Obergrenze, Ausfall, kein Ort, fehlend)', () => {
    expect(unwetterLage(teil([warnung('schwer', 'DAUERREGEN')], 6 * STUNDE + 1), JETZT)).toBeNull();
    expect(unwetterLage({ zustand: 'ausfall' }, JETZT)).toBeNull();
    expect(unwetterLage({ zustand: 'kein_ort' }, JETZT)).toBeNull();
    expect(unwetterLage(undefined, JETZT)).toBeNull();
  });
});

describe('paarSchluessel', () => {
  it('Ereignis getrimmt und in Versalien, dazu die Stufe', () => {
    expect(paarSchluessel({ stufe: 'schwer', ereignis: ' Schweres Gewitter ' })).toBe(
      'schwer|SCHWERES GEWITTER',
    );
  });
});

describe('erkenneNeue', () => {
  const leer: UnwetterGedaechtnis = {};

  it('erstes Öffnen: eine gültige Unwetterwarnung ist neu', () => {
    const w = warnung('schwer', 'SCHWERES GEWITTER');
    const r = erkenneNeue(leer, [w], JETZT);
    expect(r.neu).toBe(w);
    expect(r.weitere).toBe(0);
    expect(r.gedaechtnis).toEqual({
      'schwer|SCHWERES GEWITTER': { stufe: 'schwer', gesehenAt: JETZT },
    });
  });

  it('ohne Unwetter: nichts neu, Gedächtnis bleibt leer', () => {
    expect(erkenneNeue(leer, [], JETZT)).toEqual({ neu: null, weitere: 0, gedaechtnis: {} });
  });

  it('Aktualisierung mit neuem Ende: nicht neu, gesehen wird fortgeschrieben', () => {
    const vorher = erkenneNeue(leer, [warnung('schwer', 'DAUERREGEN')], JETZT - 10 * MIN);
    const r = erkenneNeue(
      vorher.gedaechtnis,
      [warnung('schwer', 'DAUERREGEN', -STUNDE, 8 * STUNDE)],
      JETZT,
    );
    expect(r.neu).toBeNull();
    expect(r.gedaechtnis['schwer|DAUERREGEN'].gesehenAt).toBe(JETZT);
  });

  it('Hochstufung schwer → extrem ist neu', () => {
    const vorher = erkenneNeue(leer, [warnung('schwer', 'ERGIEBIGER DAUERREGEN')], JETZT - STUNDE);
    const extrem = warnung('extrem', 'EXTREM ERGIEBIGER DAUERREGEN');
    expect(erkenneNeue(vorher.gedaechtnis, [extrem], JETZT).neu).toBe(extrem);
  });

  it('Herabstufung extrem → schwer mit anderem Ereignisnamen ist nicht neu', () => {
    const vorher = erkenneNeue(
      leer,
      [warnung('extrem', 'EXTREM ERGIEBIGER DAUERREGEN')],
      JETZT - STUNDE,
    );
    const r = erkenneNeue(vorher.gedaechtnis, [warnung('schwer', 'ERGIEBIGER DAUERREGEN')], JETZT);
    expect(r.neu).toBeNull();
    // Die herabgestufte Warnung ist trotzdem verzeichnet.
    expect(r.gedaechtnis['schwer|ERGIEBIGER DAUERREGEN']).toEqual({
      stufe: 'schwer',
      gesehenAt: JETZT,
    });
  });

  it('eine weitere Gefahr derselben Stufe ist neu', () => {
    const vorher = erkenneNeue(leer, [warnung('schwer', 'DAUERREGEN')], JETZT - STUNDE);
    const gewitter = warnung('schwer', 'SCHWERES GEWITTER');
    expect(
      erkenneNeue(vorher.gedaechtnis, [warnung('schwer', 'DAUERREGEN'), gewitter], JETZT).neu,
    ).toBe(gewitter);
  });

  it('Lücke unter 6 h: nicht neu; Wiederkehr nach mehr als 6 h: neu', () => {
    const vorher = erkenneNeue(leer, [warnung('schwer', 'DAUERREGEN')], JETZT);
    const nachLuecke = erkenneNeue(
      erkenneNeue(vorher.gedaechtnis, [], JETZT + STUNDE).gedaechtnis,
      [warnung('schwer', 'DAUERREGEN')],
      JETZT + UNWETTER_FENSTER_MS,
    );
    expect(nachLuecke.neu).toBeNull();

    const spaet = JETZT + UNWETTER_FENSTER_MS + 1;
    const wiederkehr = erkenneNeue(vorher.gedaechtnis, [warnung('schwer', 'DAUERREGEN')], spaet);
    expect(wiederkehr.neu).not.toBeNull();
  });

  it('räumt Einträge älter als 6 h ab', () => {
    const alt: UnwetterGedaechtnis = {
      'extrem|ORKAN': { stufe: 'extrem', gesehenAt: JETZT - UNWETTER_FENSTER_MS - 1 },
    };
    expect(erkenneNeue(alt, [], JETZT).gedaechtnis).toEqual({});
  });

  it('eine abgelaufene Herabstufungs-Sperre (> 6 h) lässt schwer wieder alarmieren', () => {
    const alt: UnwetterGedaechtnis = {
      'extrem|ORKAN': { stufe: 'extrem', gesehenAt: JETZT - UNWETTER_FENSTER_MS - 1 },
    };
    expect(erkenneNeue(alt, [warnung('schwer', 'STURM')], JETZT).neu).not.toBeNull();
  });

  it('zwei neue zugleich: die höchste Stufe, dann der früheste Beginn; der Rest zählt als weitere', () => {
    const spaet = warnung('schwer', 'DAUERREGEN', 3 * STUNDE, 6 * STUNDE);
    const frueh = warnung('schwer', 'SCHWERES GEWITTER', STUNDE, 2 * STUNDE);
    expect(erkenneNeue(leer, [spaet, frueh], JETZT)).toMatchObject({ neu: frueh, weitere: 1 });

    const extrem = warnung('extrem', 'ORKAN', 4 * STUNDE, 6 * STUNDE);
    expect(erkenneNeue(leer, [frueh, extrem], JETZT)).toMatchObject({ neu: extrem, weitere: 1 });
  });

  it('zwei Warnungen desselben Paars (zwei Zeiträume) zählen als eine', () => {
    const a = warnung('schwer', 'DAUERREGEN', -STUNDE, 3 * STUNDE);
    const b = warnung('schwer', 'DAUERREGEN', 3 * STUNDE, 9 * STUNDE);
    expect(erkenneNeue(leer, [a, b], JETZT)).toMatchObject({ neu: a, weitere: 0 });
  });
});

describe('Texte', () => {
  it('Hinweis: Stufenbezeichnung als Titel, Ereignis und Zeitraum als Beschreibung', () => {
    const w = warnung('schwer', 'SCHWERES GEWITTER', 2.5 * STUNDE, 5.5 * STUNDE);
    expect(unwetterHinweisText(w, 0, JETZT, BERLIN)).toEqual({
      titel: 'Unwetterwarnung',
      beschreibung: 'Schweres Gewitter, ab 17:00 · bis 20:00',
    });
    expect(unwetterHinweisText(w, 1, JETZT, BERLIN).beschreibung).toBe(
      'Schweres Gewitter, ab 17:00 · bis 20:00 (+ 1 weitere)',
    );
    expect(unwetterHinweisText(warnung('extrem', 'ORKANBÖEN'), 0, JETZT, BERLIN).titel).toBe(
      'Extremes Unwetter',
    );
  });

  it('Marke: Stufenbezeichnung und Ereignis', () => {
    expect(unwetterMarkenText(warnung('schwer', 'ORKANBÖEN'))).toBe('Unwetterwarnung: Orkanböen');
  });
});

describe('naechsterUnwetterWechsel', () => {
  it('der früheste künftige Beginn oder das früheste Ende einer Unwetterwarnung, oder die Obergrenze', () => {
    const t = teil([
      warnung('schwer', 'DAUERREGEN', -STUNDE, 3 * STUNDE),
      warnung('extrem', 'ORKAN', 2 * STUNDE, 4 * STUNDE),
      warnung('maessig', 'STURM', -STUNDE, 10 * MIN),
    ]);
    expect(naechsterUnwetterWechsel(t, JETZT)).toBe(JETZT + 2 * STUNDE);
    // Die Obergrenze des Stands (abgerufen vor 5 min + 6 h) kommt vor dem Ende.
    const lang = teil([warnung('schwer', 'DAUERREGEN', -STUNDE, 9 * STUNDE)]);
    expect(naechsterUnwetterWechsel(lang, JETZT)).toBe(JETZT - 5 * MIN + UNWETTER_FENSTER_MS + 1);
  });

  it('ohne Unwetter und ohne Stand: kein Wechsel', () => {
    expect(naechsterUnwetterWechsel(teil([]), JETZT)).toBeNull();
    expect(naechsterUnwetterWechsel({ zustand: 'kein_ort' }, JETZT)).toBeNull();
    expect(naechsterUnwetterWechsel(undefined, JETZT)).toBeNull();
  });
});
