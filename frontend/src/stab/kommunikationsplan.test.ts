import { describe, expect, it } from 'vitest';
import type {
  Einheit,
  Einsatzabschnitt,
  KommunikationsStelle,
  SkizzenVerbindung,
  Sprechgruppe,
  Stab,
} from '../api/types';
import {
  baueKommunikationsplan,
  brauchtRueckfrage,
  entfernText,
  entfernUmfang,
  verbindungsVerweis,
  type KommunikationsplanQuellen,
} from './kommunikationsplan';
import type { Quelle } from './luecken';

function abschnitt(id: number, p: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt {
  return { id, einsatz_id: 1, name: `Abschnitt ${id}`, sortier: id, sprechgruppen: [], ...p };
}

function einheit(id: number, p: Partial<Einheit> = {}): Einheit {
  return {
    id,
    einsatz_id: 1,
    name: `Einheit ${id}`,
    sortier: id,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    status: { quelle: 'ohne', verteilung: [] },
    ...p,
  } as Einheit;
}

function stelle(id: number, p: Partial<KommunikationsStelle> = {}): KommunikationsStelle {
  return {
    id,
    stellenart: 'leitstelle',
    bezeichnung: `Stelle ${id}`,
    verbindungen: [],
    sprechgruppen: [],
    ...p,
  };
}

const daten = <T>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });

function stab(besetzung: Stab['besetzung']): Stab {
  return { besetzung, anzahl_lagebesprechungen: 0 } as Stab;
}

function quellen(p: Partial<KommunikationsplanQuellen> = {}): KommunikationsplanQuellen {
  return {
    einsatzId: 7,
    stellen: daten([]),
    abschnitte: daten([]),
    einheiten: daten([]),
    stab: { zustand: 'daten', daten: stab([]) },
    ...p,
  };
}

describe('baueKommunikationsplan', () => {
  it('liefert die vier Gruppen in fester Folge', () => {
    const plan = baueKommunikationsplan(quellen());
    expect(plan.map((g) => [g.art, g.titel])).toEqual([
      ['stab', 'Einsatzleitung und Stab'],
      ['abschnitte', 'Abschnitte'],
      ['einheiten', 'Einheiten'],
      ['extern', 'Externe Stellen'],
    ]);
  });

  it('trennt gepflegte Funktionen von externen Stellen und behält die Serverfolge', () => {
    const plan = baueKommunikationsplan(
      quellen({
        stellen: daten([
          stelle(3, {
            stellenart: 'funktion',
            funktion: 'el',
            funktion_label: 'Einsatzleitung',
            bezeichnung: undefined,
          }),
          stelle(1, {
            stellenart: 'funktion',
            funktion: 's4',
            funktion_label: 'S4 Versorgung',
            bezeichnung: undefined,
          }),
          stelle(2, { stellenart: 'leitstelle', bezeichnung: 'ILS Nord' }),
          stelle(4, { stellenart: 'behoerde', bezeichnung: 'Polizei PI Nord' }),
        ]),
      }),
    );
    expect(plan[0].zeilen.map((z) => z.kennung)).toEqual(['Einsatzleitung', 'S4 Versorgung']);
    expect(plan[3].zeilen.map((z) => [z.kennung, z.nebentext])).toEqual([
      ['ILS Nord', 'Leitstelle'],
      ['Polizei PI Nord', 'Behörde'],
    ]);
  });

  it('nennt bei Fachberater und FHP Label und Bezeichnung', () => {
    const plan = baueKommunikationsplan(
      quellen({
        stellen: daten([
          stelle(1, {
            stellenart: 'funktion',
            funktion: 'fachberater',
            funktion_label: 'Fachberater',
            bezeichnung: 'THW',
          }),
        ]),
      }),
    );
    expect(plan[0].zeilen[0].kennung).toBe('Fachberater · THW');
    expect(plan[0].zeilen[0].nebentext).toBeNull();
  });

  it('zeigt die Besetzung nur bei S1–S6 als Nebentext', () => {
    const besetzung = stab([
      {
        sachgebiet: 's2',
        besetzung_art: 'personal',
        name: 'Erika Muster',
        personal_noch_disponiert: true,
      } as Stab['besetzung'][number],
      { sachgebiet: 's3', besetzung_art: 'einsatzleitung' } as Stab['besetzung'][number],
      {
        sachgebiet: 's6',
        besetzung_art: 'rueckwaertig',
        name: 'ILS Nord',
      } as Stab['besetzung'][number],
    ]);
    const f = (id: number, funktion: KommunikationsStelle['funktion']) =>
      stelle(id, {
        stellenart: 'funktion',
        funktion,
        funktion_label: funktion,
        bezeichnung: undefined,
      });
    const plan = baueKommunikationsplan(
      quellen({
        stellen: daten([f(1, 'el'), f(2, 's2'), f(3, 's3'), f(4, 's4'), f(5, 's6'), f(6, 's7')]),
        stab: { zustand: 'daten', daten: besetzung },
      }),
    );
    expect(plan[0].zeilen.map((z) => z.nebentext)).toEqual([
      null,
      'Erika Muster',
      'Einsatzleitung',
      'nicht vergeben',
      'ILS Nord (rückwärtig)',
      null,
    ]);
  });

  it('sagt beim Nebentext, warum die Besetzung fehlt, statt „nicht vergeben“ zu behaupten', () => {
    const plan = baueKommunikationsplan(
      quellen({
        stellen: daten([
          stelle(1, {
            stellenart: 'funktion',
            funktion: 's2',
            funktion_label: 'S2 Lage',
            bezeichnung: undefined,
          }),
        ]),
        stab: { zustand: 'fehler', daten: undefined },
      }),
    );
    expect(plan[0].zeilen[0].nebentext).toBe('Besetzung nicht geladen');
  });

  it('übernimmt keine Telefonnummer aus dem Personal', () => {
    // Die Quellen kennen gar kein Personal; der Test hält fest, dass die Besetzung nur den Namen
    // trägt, auch wenn ihr Datensatz mehr Felder hätte.
    const plan = baueKommunikationsplan(
      quellen({
        stellen: daten([
          stelle(1, {
            stellenart: 'funktion',
            funktion: 's2',
            funktion_label: 'S2 Lage',
            bezeichnung: undefined,
          }),
        ]),
        stab: {
          zustand: 'daten',
          daten: stab([
            {
              sachgebiet: 's2',
              besetzung_art: 'personal',
              name: 'Erika Muster',
              personal_noch_disponiert: true,
              telefon: '0170 555',
            } as unknown as Stab['besetzung'][number],
          ]),
        },
      }),
    );
    expect(JSON.stringify(plan)).not.toContain('0170 555');
    expect(plan[0].zeilen[0].verbindungen).toEqual([]);
  });

  it('leitet Abschnitte und Einheiten nur mit Angaben ab und verweist auf ihren Datensatz', () => {
    const plan = baueKommunikationsplan(
      quellen({
        abschnitte: daten([
          abschnitt(1, {
            name: 'EA Nord',
            kurzbezeichnung: 'EA N',
            kommunikationsmittel: 'festnetz',
            erreichbarkeit: '0421 77',
          }),
          abschnitt(2),
        ]),
        einheiten: daten([
          einheit(5, {
            name: '1. Zug',
            funkrufname: 'Florian 1',
            kommunikationsmittel: 'mobil',
            erreichbarkeit: '0151 23456',
          }),
          einheit(6, { name: '2. Zug' }),
          einheit(7, { name: '3. Zug', kommunikationsmittel: 'digitalfunk' }),
        ]),
      }),
    );
    const [ab] = plan[1].zeilen;
    expect(plan[1].zeilen).toHaveLength(1);
    expect(ab).toMatchObject({ art: 'abschnitt', kennung: 'EA Nord', nebentext: 'EA N' });
    expect(ab.art === 'abschnitt' && ab.ziel).toBe('/einsaetze/7/einsatzabschnitte?abschnitt=1');
    expect(ab.verbindungen[0]).toMatchObject({
      mittelLabel: 'Festnetz',
      wert: '0421 77',
      verweis: 'tel:042177',
    });

    expect(plan[2].zeilen.map((z) => z.kennung)).toEqual(['1. Zug', '3. Zug']);
    const [zug1, zug3] = plan[2].zeilen;
    expect(zug1.art === 'einheit' && zug1.ziel).toBe('/einsaetze/7/einheiten/5');
    expect(zug1.verbindungen[0]).toMatchObject({
      mittelLabel: 'Mobil',
      wert: '0151 23456',
      verweis: 'tel:015123456',
    });
    // Digitalfunk ohne Erreichbarkeit: das Mittel steht, nichts ist antippbar.
    expect(zug3.verbindungen[0]).toMatchObject({
      mittelLabel: 'Digitalfunk',
      wert: '',
      verweis: null,
    });
  });

  it('macht aus einer gesperrten oder ladenden Quelle keinen leeren Bestand', () => {
    const plan = baueKommunikationsplan(
      quellen({
        stellen: { zustand: 'laden', daten: [] },
        einheiten: { zustand: 'gesperrt', daten: [einheit(1, { erreichbarkeit: '1' })] },
      }),
    );
    expect(plan.map((g) => g.zustand)).toEqual(['laden', 'daten', 'gesperrt', 'laden']);
    expect(plan[2].zeilen).toEqual([]);
  });

  it('erfindet keine Zeile für die eigene Führungsstelle', () => {
    const plan = baueKommunikationsplan(quellen());
    expect(plan.flatMap((g) => g.zeilen)).toEqual([]);
    expect(JSON.stringify(plan)).not.toMatch(/Führungsstelle/);
  });

  it('übernimmt gepflegte Verbindungen in Serverfolge mit Label, Hinweis und Verweis', () => {
    const plan = baueKommunikationsplan(
      quellen({
        stellen: daten([
          stelle(1, {
            bezeichnung: 'ILS Nord',
            verbindungen: [
              { id: 10, mittel: 'festnetz', wert: '0421 1234', hinweis: 'Lagedienst' },
              { id: 11, mittel: 'fax', wert: '0421 1235' },
              { id: 12, mittel: 'email', wert: 'lagedienst@ils.example' },
            ],
          }),
        ]),
      }),
    );
    expect(plan[3].zeilen[0].verbindungen).toEqual([
      {
        schluessel: 'st-1-v10',
        id: 10,
        mittel: 'festnetz',
        mittelLabel: 'Festnetz',
        wert: '0421 1234',
        hinweis: 'Lagedienst',
        verweis: 'tel:04211234',
      },
      {
        schluessel: 'st-1-v11',
        id: 11,
        mittel: 'fax',
        mittelLabel: 'Fax',
        wert: '0421 1235',
        hinweis: null,
        verweis: null,
      },
      {
        schluessel: 'st-1-v12',
        id: 12,
        mittel: 'email',
        mittelLabel: 'E-Mail',
        wert: 'lagedienst@ils.example',
        hinweis: null,
        verweis: 'mailto:lagedienst@ils.example',
      },
    ]);
  });
});

describe('verbindungsVerweis', () => {
  it('wählt nur bei Festnetz und Mobil, mit führendem Plus', () => {
    expect(verbindungsVerweis('mobil', '+49 (170) 123-45')).toBe('tel:+4917012345');
    expect(verbindungsVerweis('festnetz', '0421/1234')).toBe('tel:04211234');
    expect(verbindungsVerweis('fax', '0421 1234')).toBeNull();
    expect(verbindungsVerweis('messenger', '0170 1')).toBeNull();
    expect(verbindungsVerweis(null, '0170 1')).toBeNull();
  });

  it('macht Text ohne Ziffern nicht wählbar', () => {
    expect(verbindungsVerweis('mobil', 'über Lagedienst')).toBeNull();
    expect(verbindungsVerweis('mobil', '12')).toBeNull();
  });

  it('nimmt E-Mail nur mit @ und ohne Leerzeichen', () => {
    expect(verbindungsVerweis('email', 'a@b.de')).toBe('mailto:a@b.de');
    expect(verbindungsVerweis('email', 'Postfach Lage')).toBeNull();
    expect(verbindungsVerweis('email', 'a @b.de')).toBeNull();
  });
});

// ── LFH-893: Kanäle externer Stellen und Entfernen mit Skizzen-Verbindungen ──────────────────

const TMO_SL_AS: Sprechgruppe = {
  id: 31,
  bezeichnung: 'SL AS',
  betriebsart: 'TMO',
  aktiv: true,
  einsatz_lokal: false,
  sortier: 1,
};
const DMO_505: Sprechgruppe = { ...TMO_SL_AS, id: 32, bezeichnung: '505', betriebsart: 'DMO' };

function skizzenVerbindung(id: number, stelleId: number): SkizzenVerbindung {
  return {
    id,
    von: { art: 'fuehrungsstelle', id: null },
    nach: { art: 'stelle', id: stelleId },
    art: 'daten',
    medium: 'leitung',
    status: 'bestehend',
    verkehr: null,
    hinweis: null,
  };
}

describe('Kanäle externer Stellen (LFH-893)', () => {
  it('nennt die Kanäle einer externen Stelle mit Betriebsart, geplante mit dem Wort', () => {
    const plan = baueKommunikationsplan(
      quellen({
        stellen: daten([
          stelle(2, {
            bezeichnung: 'ILS Musterhausen',
            sprechgruppen: [
              { sprechgruppe: TMO_SL_AS, status: 'geplant' },
              { sprechgruppe: DMO_505, status: 'bestehend' },
            ],
          }),
        ]),
      }),
    );
    expect(plan[3].zeilen[0].kanaele).toEqual(['TMO SL AS (geplant)', 'DMO 505']);
  });

  it('hat an Funktionen, Abschnitten und Einheiten keine Kanäle', () => {
    const plan = baueKommunikationsplan(
      quellen({
        stellen: daten([stelle(1, { stellenart: 'funktion', funktion: 's2' })]),
        abschnitte: daten([abschnitt(4, { kommunikationsmittel: 'festnetz' })]),
      }),
    );
    expect(plan[0].zeilen[0].kanaele).toEqual([]);
    expect(plan[1].zeilen[0].kanaele).toEqual([]);
  });
});

describe('entfernUmfang / entfernText (LFH-893)', () => {
  const ils = stelle(3, {
    bezeichnung: 'ILS',
    verbindungen: [],
    sprechgruppen: [{ sprechgruppe: TMO_SL_AS, status: 'bestehend' }],
  });

  it('zählt Verbindungen, Sprechgruppen und Skizzen-Verbindungen der Stelle', () => {
    const u = entfernUmfang(ils, {
      zustand: 'daten',
      daten: [skizzenVerbindung(1, 3), skizzenVerbindung(2, 9)],
    });
    expect(u).toEqual({ verbindungen: 0, sprechgruppen: 1, skizzenVerbindungen: 1 });
    expect(brauchtRueckfrage(u)).toBe(true);
    expect(entfernText('ILS', u)).toBe(
      '„ILS“ wird aus dem Kommunikationsplan entfernt, mit 1 Sprechgruppe und 1 Skizzen-Verbindung.',
    );
  });

  it('zählt eine Verbindung von der Stelle aus ebenso', () => {
    const v = { ...skizzenVerbindung(1, 9), von: { art: 'stelle' as const, id: 3 } };
    expect(entfernUmfang(ils, { zustand: 'daten', daten: [v] }).skizzenVerbindungen).toBe(1);
  });

  it('fragt ohne Verbindungen, Kanäle und Skizzen-Verbindungen nicht nach', () => {
    const leer = stelle(4, { verbindungen: [], sprechgruppen: [] });
    const u = entfernUmfang(leer, { zustand: 'daten', daten: [skizzenVerbindung(1, 3)] });
    expect(brauchtRueckfrage(u)).toBe(false);
  });

  it('fragt nach, wenn die Skizze nicht geladen ist, und sagt das', () => {
    const leer = stelle(4, { verbindungen: [], sprechgruppen: [] });
    const u = entfernUmfang(leer, { zustand: 'fehler', daten: [] });
    expect(u.skizzenVerbindungen).toBeNull();
    expect(brauchtRueckfrage(u)).toBe(true);
    expect(entfernText('Polizei', u)).toBe(
      '„Polizei“ wird aus dem Kommunikationsplan entfernt. Ob sie in der Fernmeldeskizze ' +
        'verbunden ist, ist nicht bekannt (Fernmeldeskizze nicht geladen); ihre Verbindungen ' +
        'dort gehen mit.',
    );
  });

  it('nennt mehrere Verbindungen in der Mehrzahl', () => {
    expect(
      entfernText('Polizei PI Nord', { verbindungen: 2, sprechgruppen: 0, skizzenVerbindungen: 0 }),
    ).toBe('„Polizei PI Nord“ wird aus dem Kommunikationsplan entfernt, mit 2 Verbindungen.');
  });
});
