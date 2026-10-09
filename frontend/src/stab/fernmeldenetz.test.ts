import { describe, expect, it } from 'vitest';
import type {
  Fernmeldeskizze,
  KommunikationsStelleMitKanaelen,
  SkizzenVerbindung,
  Verbindungsstatus,
} from '../api/fernmeldeskizzeVertrag';
import type {
  Einheit,
  Einsatzabschnitt,
  Fuehrungsstelle,
  KommunikationsStelle,
  Sprechgruppe,
} from '../api/types';
import {
  EINSATZLEITUNG,
  baueFernmeldenetz,
  lueckenAmBild,
  type ElementLueckeArt,
  type FernmeldenetzQuellen,
  type NetzStelle,
} from './fernmeldeskizze';
import { besetzt, fahrzeug } from '../test/fernmeldenetz';
import {
  abschnitteOhneSprechgruppe,
  einheitenOhneSprechgruppe,
  lokaleSprechgruppenOhneZuordnung,
  verbindungenOhneGemeinsameSprechgruppe,
  type Quelle,
} from './luecken';

/**
 * Das Netzmodell der taktischen Fernmeldeskizze (LFH-893 D2): Szenarien aus dem Spec-Delta
 * `stab-fernmeldeskizze` und ein Eigenschaftstest „Lücken am Bild = Lücken im Paneel“ (D11).
 */

function sg(
  id: number,
  betriebsart: 'TMO' | 'DMO',
  bezeichnung: string,
  lokal = false,
): Sprechgruppe {
  return { id, bezeichnung, betriebsart, aktiv: true, einsatz_lokal: lokal, sortier: id };
}
const BN_BOS = sg(1, 'TMO', 'BN_BOS');
const F314 = sg(2, 'DMO', '314_F*');
const SL_AS = sg(3, 'TMO', 'SL AS');
const TMO311 = sg(4, 'TMO', '311');
const DMO505 = sg(5, 'DMO', '505');

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

function stelle(
  id: number,
  stellenart: KommunikationsStelle['stellenart'],
  p: {
    bezeichnung?: string;
    kanaele?: [Sprechgruppe, Verbindungsstatus][];
    rufnummer?: string;
  } = {},
): KommunikationsStelleMitKanaelen {
  return {
    id,
    stellenart,
    bezeichnung: p.bezeichnung ?? `Stelle ${id}`,
    verbindungen: p.rufnummer ? [{ id: id * 10, mittel: 'festnetz', wert: p.rufnummer }] : [],
    sprechgruppen: (p.kanaele ?? []).map(([sprechgruppe, status]) => ({ sprechgruppe, status })),
  };
}

function verbindung(
  id: number,
  von: SkizzenVerbindung['von'],
  nach: SkizzenVerbindung['nach'],
  p: Partial<SkizzenVerbindung> = {},
): SkizzenVerbindung {
  return {
    id,
    von,
    nach,
    art: 'daten',
    medium: 'leitung',
    status: 'bestehend',
    verkehr: null,
    hinweis: null,
    ...p,
  };
}

const LEER_SKIZZE: Fernmeldeskizze = {
  lage: [],
  komponenten: [],
  verbindungen: [],
  bereiche: [],
  schriftfeld: {
    herausgeber: null,
    vs_vermerk: 'keiner',
    gueltig_ab: null,
    gez_name: null,
    gez_at: null,
  },
  stand: null,
};

const daten = <T>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });
const fs = (p: Partial<Fuehrungsstelle> = {}): FernmeldenetzQuellen['fuehrungsstelle'] => ({
  zustand: 'daten',
  daten: { sprechgruppen: [], fahrzeug_ids: [], ...p },
});

function quellen(
  p: Partial<Omit<FernmeldenetzQuellen, 'skizze'>> & { skizze?: Partial<Fernmeldeskizze> } = {},
): FernmeldenetzQuellen {
  const { skizze, ...rest } = p;
  return {
    einsatzId: 7,
    abschnitte: daten([]),
    einheiten: daten([]),
    fuehrungsstelle: { zustand: 'daten', daten: null },
    sprechgruppen: daten([]),
    stellen: daten([]),
    fahrzeuge: daten([]),
    besetzung: daten([]),
    skizze: { zustand: 'daten', daten: { ...LEER_SKIZZE, ...skizze } },
    ...rest,
  };
}

const stelleMit = (netz: ReturnType<typeof baueFernmeldenetz>, key: string): NetzStelle => {
  const s = netz.stellen.find((x) => x.key === key);
  if (!s) throw new Error(`Stelle ${key} fehlt`);
  return s;
};
const lueckenArten = (netz: ReturnType<typeof baueFernmeldenetz>, key: string) =>
  [...netz.stellen, ...netz.schienen].find((x) => x.key === key)?.luecken.map((l) => l.art);

describe('baueFernmeldenetz · Sammelschienen (Spec „Eine Sammelschiene je Sprechgruppe“)', () => {
  it('Vier Stellen auf einem Kanal: eine Schiene, vier Stichleitungen, keine Kante', () => {
    const netz = baueFernmeldenetz(
      quellen({
        fuehrungsstelle: fs({ rufname: 'Florian Musterstadt 10/1', sprechgruppen: [BN_BOS] }),
        abschnitte: daten([
          abschnitt(1, { name: 'EA 1', sprechgruppen: [BN_BOS] }),
          abschnitt(2, { name: 'EA 2', sprechgruppen: [BN_BOS] }),
          abschnitt(3, { name: 'EA 3', sprechgruppen: [BN_BOS] }),
        ]),
      }),
    );
    expect(netz.schienen).toHaveLength(1);
    expect(netz.schienen[0]).toMatchObject({
      key: 'sg-1',
      betriebsart: 'TMO',
      bezeichnung: 'BN_BOS',
      zeichen: 'TMO BN_BOS',
    });
    expect(netz.schienen[0].teilnehmer.map((t) => t.element)).toEqual([
      'fs',
      'ab-1',
      'ab-2',
      'ab-3',
    ]);
    expect(netz.verbindungen).toEqual([]);
  });

  it('Übergang zwischen zwei Kanälen: „EA 1“ hängt an beiden Schienen', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([
          abschnitt(1, { name: 'EA 1', sprechgruppen: [BN_BOS, F314] }),
          abschnitt(2, { name: 'EA 2', sprechgruppen: [BN_BOS] }),
        ]),
      }),
    );
    const an = (key: string) =>
      netz.schienen.filter((s) => s.teilnehmer.some((t) => t.element === key)).map((s) => s.key);
    expect(an('ab-1')).toEqual(['sg-1', 'sg-2']);
    expect(an('ab-2')).toEqual(['sg-1']);
  });

  it('trägt den Hinweis der Sprechgruppe und ordnet TMO vor DMO', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([
          abschnitt(1, { sprechgruppen: [{ ...F314, hinweis: 'Gesundheit' }, BN_BOS] }),
        ]),
      }),
    );
    expect(netz.schienen.map((s) => [s.key, s.hinweis])).toEqual([
      ['sg-1', null],
      ['sg-2', 'Gesundheit'],
    ]);
  });

  it('nimmt einsatzlokale Sprechgruppen ohne Teilnehmer als Schiene auf', () => {
    const lokal = sg(9, 'DMO', '999', true);
    const netz = baueFernmeldenetz(quellen({ sprechgruppen: daten([lokal, BN_BOS]) }));
    expect(netz.schienen.map((s) => [s.key, s.herkunft, s.teilnehmer.length])).toEqual([
      ['sg-9', 'einsatzlokal', 0],
    ]);
  });
});

describe('baueFernmeldenetz · Stellen', () => {
  it('Wurzel: ohne erfasste Führungsstelle steht der Grund, ohne Stichleitung und ohne Urteil', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1, { name: 'EA Nord', sprechgruppen: [DMO505] })]),
      }),
    );
    expect(stelleMit(netz, 'fs')).toMatchObject({
      art: 'fuehrungsstelle',
      bezeichnung: EINSATZLEITUNG,
      erfasst: false,
      hinweis: 'Gegenstelle nicht erfasst',
      rufname: null,
    });
    expect(netz.schienen.flatMap((s) => s.teilnehmer).some((t) => t.element === 'fs')).toBe(false);
    expect(lueckenArten(netz, 'ab-1')).not.toContain('keine-gemeinsame');
  });

  it('Wurzel mit erfasster Führungsstelle: Rufname, Schiene, keine Erreichbarkeit', () => {
    const netz = baueFernmeldenetz(
      quellen({
        fuehrungsstelle: fs({
          rufname: 'Florian Musterstadt 10/1',
          erreichbarkeit: '0171 GEHEIM',
          sprechgruppen: [TMO311],
        }),
      }),
    );
    expect(stelleMit(netz, 'fs')).toMatchObject({
      bezeichnung: EINSATZLEITUNG,
      erfasst: true,
      hinweis: null,
      rufname: 'Florian Musterstadt 10/1',
    });
    expect(netz.schienen[0].teilnehmer).toEqual([{ element: 'fs', status: 'bestehend' }]);
    expect(JSON.stringify(netz.stellen)).not.toContain('GEHEIM');
  });

  it('nennt den Grund, wenn die Führungsstelle nicht geladen ist', () => {
    const netz = baueFernmeldenetz(
      quellen({ fuehrungsstelle: { zustand: 'fehler', daten: null } }),
    );
    expect(stelleMit(netz, 'fs')).toMatchObject({
      erfasst: false,
      hinweis: 'Gegenstelle nicht geladen',
    });
    expect(netz.fehlend).toContainEqual({
      quelle: 'fuehrungsstelle',
      name: 'Führungsstelle',
      zustand: 'fehler',
    });
  });

  it('Abschnitt mit Rufname und Einheit ohne Funkrufname, mit Zeichen und Ziel', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1, { name: 'EA 1 Gesundheit', kurzbezeichnung: 'EA 1' })]),
        einheiten: daten([
          einheit(10, { name: '1. Zug', abschnitt_id: 1, erreichbarkeit: '0160 X' }),
        ]),
      }),
    );
    expect(stelleMit(netz, 'ab-1')).toMatchObject({
      art: 'abschnitt',
      id: 1,
      bezeichnung: 'EA 1 Gesundheit',
      rufname: 'EA 1',
      oben: 'fs',
      recht: 'einsatzabschnitte',
    });
    expect(stelleMit(netz, 'ab-1').ziel).toContain('/einsaetze/7/');
    expect(stelleMit(netz, 'eh-10')).toMatchObject({
      art: 'einheit',
      bezeichnung: '1. Zug',
      rufname: null,
      oben: 'ab-1',
      recht: 'einheiten',
    });
    const eh = stelleMit(netz, 'eh-10');
    expect(eh.art === 'einheit' && eh.tz.grundzeichen).toBeTruthy();
    expect(JSON.stringify(netz)).not.toContain('0160 X');
  });

  it('Leitstelle am Kanal: Element mit Status, ohne Rufnummer; Funktion S2 erscheint nicht', () => {
    const netz = baueFernmeldenetz(
      quellen({
        stellen: daten([
          stelle(1, 'funktion', { bezeichnung: 'S2', rufnummer: '0421 222' }),
          stelle(2, 'leitstelle', {
            bezeichnung: 'ILS Musterhausen',
            kanaele: [[SL_AS, 'geplant']],
            rufnummer: '0421 112233',
          }),
        ]),
      }),
    );
    expect(netz.stellen.map((s) => s.key)).toEqual(['fs', 'ks-2']);
    expect(stelleMit(netz, 'ks-2')).toMatchObject({
      art: 'extern',
      stellenart: 'leitstelle',
      bezeichnung: 'ILS Musterhausen',
      recht: 'stab',
    });
    expect(netz.schienen[0].teilnehmer).toEqual([{ element: 'ks-2', status: 'geplant' }]);
    expect(JSON.stringify(netz)).not.toContain('0421');
  });

  it('Komponente mit Art als Bezeichnung, wenn keine erfasst ist, an ihren Schienen', () => {
    const netz = baueFernmeldenetz(
      quellen({
        skizze: {
          komponenten: [{ id: 3, art: 'repeater', bezeichnung: null, sprechgruppen: [F314] }],
        },
      }),
    );
    expect(stelleMit(netz, 'ko-3')).toMatchObject({
      art: 'komponente',
      komponentenart: 'repeater',
      bezeichnung: 'Repeater',
      recht: 'stab',
    });
    expect(netz.schienen[0].teilnehmer).toEqual([{ element: 'ko-3', status: 'bestehend' }]);
  });

  it('folgt der Führungsorganisation: Führungsstelle, Baum, externe Stellen, Komponenten', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1), abschnitt(2, { ueber_abschnitt_id: 1 }), abschnitt(3)]),
        einheiten: daten([
          einheit(10, { abschnitt_id: 1 }),
          einheit(11, { ueber_einheit_id: 10, abschnitt_id: 1 }),
          einheit(12),
        ]),
        stellen: daten([stelle(5, 'behoerde')]),
        skizze: {
          komponenten: [{ id: 4, art: 'antenne', bezeichnung: 'Mast', sprechgruppen: [] }],
        },
      }),
    );
    expect(netz.stellen.map((s) => s.key)).toEqual([
      'fs',
      'ab-1',
      'ab-2',
      'eh-10',
      'eh-11',
      'ab-3',
      'eh-12',
      'ks-5',
      'ko-4',
    ]);
    expect(netz.baum).toEqual([
      {
        key: 'ab-1',
        kinder: [
          { key: 'ab-2', kinder: [] },
          { key: 'eh-10', kinder: [{ key: 'eh-11', kinder: [] }] },
        ],
      },
      { key: 'ab-3', kinder: [] },
      { key: 'sammel', kinder: [{ key: 'eh-12', kinder: [] }] },
    ]);
    expect(stelleMit(netz, 'eh-12')).toMatchObject({ oben: null });
    expect(stelleMit(netz, 'eh-11')).toMatchObject({ oben: 'eh-10' });
  });

  it('leitet das Schreibrecht je Element aus dem Recht seines Datensatzes ab (D8)', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1)]),
        einheiten: daten([einheit(10, { abschnitt_id: 1 })]),
        stellen: daten([stelle(5, 'leitstelle')]),
        rechte: { einheiten: true, stab: true },
      }),
    );
    expect(netz.stellen.map((s) => [s.key, s.schreibbar])).toEqual([
      ['fs', false],
      ['ab-1', false],
      ['eh-10', true],
      ['ks-5', true],
    ]);
    expect(
      baueFernmeldenetz(quellen({ abschnitte: daten([abschnitt(1)]) })).stellen[1].schreibbar,
    ).toBe(false);
  });
});

describe('baueFernmeldenetz · Verbindungen, Bereiche, Lage', () => {
  it('bildet Bezüge auf Schlüssel ab und lässt verwaiste aus', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1)]),
        stellen: daten([stelle(4, 'leitstelle')]),
        skizze: {
          verbindungen: [
            verbindung(
              1,
              { art: 'fuehrungsstelle', id: null },
              { art: 'stelle', id: 4 },
              {
                status: 'geplant',
              },
            ),
            verbindung(
              2,
              { art: 'abschnitt', id: 1 },
              { art: 'einheit', id: 99 },
              { art: 'melder' },
            ),
            verbindung(3, { art: 'komponente', id: 8 }, { art: 'abschnitt', id: 1 }),
          ],
          lage: [
            { element: 'ab-1', x: 80, y: 40, breite: null, version: 2 },
            { element: 'eh-99', x: 0, y: 0, breite: null, version: 1 },
            { element: 'sg-12', x: 0, y: 0, breite: 160, version: 1 },
          ],
          bereiche: [
            {
              id: 6,
              bezeichnung: 'Rückwärtiger Bereich',
              x: 0,
              y: 0,
              breite: 400,
              hoehe: 300,
              version: 1,
            },
          ],
        },
      }),
    );
    expect(netz.verbindungen).toEqual([
      {
        key: 'vb-1',
        id: 1,
        von: 'fs',
        nach: 'ks-4',
        art: 'daten',
        medium: 'leitung',
        status: 'geplant',
        verkehr: null,
        hinweis: null,
        beschreibung: 'Daten, leitergebunden, geplant',
      },
    ]);
    expect([...netz.lage.keys()]).toEqual(['ab-1']);
    expect(netz.bereiche).toEqual([
      {
        key: 'be-6',
        id: 6,
        bezeichnung: 'Rückwärtiger Bereich',
        x: 0,
        y: 0,
        breite: 400,
        hoehe: 300,
        version: 1,
      },
    ]);
  });

  it('reicht Schriftfeld und Stand durch', () => {
    const netz = baueFernmeldenetz(
      quellen({
        skizze: {
          stand: '2026-10-04T10:00:00',
          schriftfeld: { ...LEER_SKIZZE.schriftfeld, gueltig_ab: '2026-10-04T12:00:00' },
        },
      }),
    );
    expect(netz.schriftfeld?.gueltig_ab).toBe('2026-10-04T12:00:00');
    expect(netz.stand).toBe('2026-10-04T10:00:00');
  });
});

describe('baueFernmeldenetz · fehlende Quellen (Spec „Fehlende Quellen werden benannt“)', () => {
  it('Abschnitte gesperrt: keine Fläche, nur der Grund', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: { zustand: 'gesperrt', daten: [] },
        einheiten: daten([einheit(1, { sprechgruppen: [BN_BOS] })]),
      }),
    );
    expect(netz.darstellbar).toBe(false);
    expect(netz.stellen).toEqual([]);
    expect(netz.schienen).toEqual([]);
    expect(netz.fehlend).toContainEqual({
      quelle: 'abschnitte',
      name: 'Abschnitte',
      zustand: 'gesperrt',
    });
  });

  it('Einheiten nicht geladen: Abschnitte an ihren Schienen, Hinweis', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1, { sprechgruppen: [BN_BOS] })]),
        einheiten: { zustand: 'fehler', daten: [] },
      }),
    );
    expect(netz.darstellbar).toBe(true);
    expect(netz.stellen.map((s) => s.key)).toEqual(['fs', 'ab-1']);
    expect(netz.schienen[0].teilnehmer.map((t) => t.element)).toEqual(['ab-1']);
    expect(netz.fehlend).toEqual([{ quelle: 'einheiten', name: 'Einheiten', zustand: 'fehler' }]);
  });

  it('Externe Stellen nicht geladen: Führungsstelle, Abschnitte und Einheiten bleiben', () => {
    const netz = baueFernmeldenetz(
      quellen({
        fuehrungsstelle: fs({ sprechgruppen: [BN_BOS] }),
        abschnitte: daten([abschnitt(1)]),
        einheiten: daten([einheit(2, { abschnitt_id: 1 })]),
        stellen: { zustand: 'fehler', daten: [] },
      }),
    );
    expect(netz.stellen.map((s) => s.key)).toEqual(['fs', 'ab-1', 'eh-2']);
    expect(netz.fehlend).toEqual([
      { quelle: 'stellen', name: 'Externe Stellen', zustand: 'fehler' },
    ]);
    expect(netz.luecken.leitstelle).toEqual({ zustand: 'fehler', fehlt: false, element: null });
  });

  it('Daten der Skizze nicht geladen: keine Komponenten, Verbindungen, Bereiche, Lage', () => {
    const netz = baueFernmeldenetz(
      quellen({ abschnitte: daten([abschnitt(1)]), skizze: undefined }),
    );
    expect(netz.fehlend).toEqual([]);
    const ohne = baueFernmeldenetz({ ...quellen(), skizze: { zustand: 'laden', daten: null } });
    expect(ohne.fehlend).toEqual([
      { quelle: 'skizze', name: 'Daten der Skizze', zustand: 'laden' },
    ]);
    expect(ohne.schriftfeld).toBeNull();
    expect(ohne.verbindungen).toEqual([]);
  });
});

describe('baueFernmeldenetz · Lücken am Element (D11)', () => {
  it('Einheit ohne gemeinsamen Kanal trägt „keine gemeinsame Sprechgruppe“ mit Gegenstelle', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1, { name: 'EA Nord', sprechgruppen: [TMO311] })]),
        einheiten: daten([
          einheit(10, { name: '1. Zug', abschnitt_id: 1, sprechgruppen: [DMO505] }),
        ]),
      }),
    );
    expect(stelleMit(netz, 'eh-10').luecken).toEqual([
      { art: 'keine-gemeinsame', text: 'keine gemeinsame Sprechgruppe', gegenstelle: 'ab-1' },
    ]);
  });

  it('Stelle ohne Sprechgruppe zählt nicht doppelt', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([
          abschnitt(1, { sprechgruppen: [TMO311] }),
          abschnitt(2, { ueber_abschnitt_id: 1 }),
        ]),
      }),
    );
    expect(lueckenArten(netz, 'ab-2')).toEqual(['ohne-sprechgruppe']);
    expect(stelleMit(netz, 'ab-2').luecken[0].text).toBe('keine Sprechgruppe');
  });

  it('Schiene mit nur einem Teilnehmer und lokale Sprechgruppe ohne Zuordnung', () => {
    const lokal = sg(9, 'DMO', '999', true);
    const netz = baueFernmeldenetz(
      quellen({
        sprechgruppen: daten([lokal]),
        einheiten: daten([einheit(10, { sprechgruppen: [DMO505] })]),
      }),
    );
    expect(lueckenArten(netz, 'sg-5')).toEqual(['ein-teilnehmer']);
    expect(lueckenArten(netz, 'sg-9')).toEqual(['lokal-ohne-zuordnung']);
    expect(netz.luecken.schienenMitEinemTeilnehmer.treffer).toEqual([DMO505]);
  });

  it('Leitstelle ohne Verbindung: genau eine Lücke an der ersten Leitstelle', () => {
    const netz = baueFernmeldenetz(
      quellen({
        stellen: daten([stelle(1, 'behoerde'), stelle(2, 'leitstelle'), stelle(3, 'leitstelle')]),
      }),
    );
    expect(netz.luecken.leitstelle).toEqual({ zustand: 'daten', fehlt: true, element: 'ks-2' });
    expect(lueckenArten(netz, 'ks-2')).toEqual(['leitstelle']);
    expect(lueckenArten(netz, 'ks-3')).toEqual([]);
    expect(lueckenAmBild(netz).filter((l) => l.luecke.art === 'leitstelle')).toHaveLength(1);
  });

  it('Leitstelle über eine Verbindung der Skizze verbunden: keine Lücke', () => {
    const netz = baueFernmeldenetz(
      quellen({
        stellen: daten([stelle(2, 'leitstelle')]),
        skizze: {
          verbindungen: [
            verbindung(1, { art: 'fuehrungsstelle', id: null }, { art: 'stelle', id: 2 }),
          ],
        },
      }),
    );
    expect(netz.luecken.leitstelle.fehlt).toBe(false);
  });

  it('Ohne jede Leitstelle hängt die Lücke am Netz, nicht an einem Element', () => {
    const netz = baueFernmeldenetz(quellen());
    expect(netz.luecken.leitstelle).toEqual({ zustand: 'daten', fehlt: true, element: null });
    expect(lueckenAmBild(netz)).toEqual([
      {
        element: null,
        luecke: { art: 'leitstelle', text: 'Leitstelle: keine Verbindung erfasst' },
      },
    ]);
  });
});

// ── Eigenschaftstest: Lücken am Bild = Lücken im Paneel (Spec „Lücken am Bild“) ────────────────

/** Deterministischer Zufall (mulberry32), damit ein roter Lauf wiederholbar ist. */
function zufall(saat: number) {
  let a = saat >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zufallsGliederung(saat: number): FernmeldenetzQuellen {
  const r = zufall(saat);
  const ganz = (n: number) => Math.floor(r() * n);
  const gruppen = [
    ...Array.from({ length: 6 }, (_, i) => sg(i + 1, i % 2 ? 'DMO' : 'TMO', `G${i + 1}`)),
    sg(50, 'DMO', 'L50', true),
    sg(51, 'TMO', 'L51', true),
  ];
  const auswahl = () => gruppen.filter(() => r() < 0.25);
  const nA = 1 + ganz(6);
  const abschnitte = Array.from({ length: nA }, (_, i) =>
    abschnitt(i + 1, {
      sprechgruppen: auswahl(),
      // Unterabschnitte, Waisen (99) und gelegentlich ein Ring.
      ueber_abschnitt_id: r() < 0.3 ? 1 + ganz(nA) : r() < 0.1 ? 99 : null,
    }),
  );
  const nE = ganz(12);
  const einheiten = Array.from({ length: nE }, (_, i) =>
    einheit(100 + i, {
      sprechgruppen: auswahl(),
      abschnitt_id: r() < 0.85 ? 1 + ganz(nA + 1) : null,
      ueber_einheit_id: r() < 0.25 ? 100 + ganz(nE) : null,
    }),
  );
  const stellen = Array.from({ length: ganz(4) }, (_, i) =>
    stelle(200 + i, (['leitstelle', 'behoerde', 'funktion', 'sonstige'] as const)[ganz(4)], {
      kanaele: auswahl().map((s) => [s, r() < 0.5 ? 'geplant' : 'bestehend']),
    }),
  );
  return quellen({
    abschnitte: daten(abschnitte),
    einheiten: daten(einheiten),
    fuehrungsstelle:
      r() < 0.7 ? fs({ sprechgruppen: auswahl() }) : { zustand: 'daten', daten: null },
    sprechgruppen: daten(gruppen),
    stellen: daten(stellen),
    skizze: {
      komponenten:
        r() < 0.5 ? [{ id: 1, art: 'repeater', bezeichnung: null, sprechgruppen: auswahl() }] : [],
      lage:
        r() < 0.5 ? [{ element: `sg-${1 + ganz(6)}`, x: 0, y: 0, breite: 160, version: 1 }] : [],
    },
  });
}

describe('baueFernmeldenetz · Eigenschaft: Lücken am Bild zählen wie das Paneel', () => {
  it.each(Array.from({ length: 200 }, (_, i) => i + 1))('Gliederung %i', (saat) => {
    const q = zufallsGliederung(saat);
    const netz = baueFernmeldenetz(q);
    const amBild = lueckenAmBild(netz);
    const zahl = (art: ElementLueckeArt) => amBild.filter((l) => l.luecke.art === art).length;

    expect(zahl('ohne-sprechgruppe')).toBe(
      abschnitteOhneSprechgruppe(q.abschnitte).treffer.length +
        einheitenOhneSprechgruppe(q.einheiten).treffer.length,
    );
    expect(zahl('keine-gemeinsame')).toBe(
      verbindungenOhneGemeinsameSprechgruppe(q.abschnitte, q.einheiten, q.fuehrungsstelle).treffer
        .length,
    );
    expect(zahl('lokal-ohne-zuordnung')).toBe(
      // Wie das Paneel der Seite: Kanäle externer Stellen und Komponenten tragen mit (Review O2).
      lokaleSprechgruppenOhneZuordnung(
        q.sprechgruppen,
        q.abschnitte,
        q.einheiten,
        q.fuehrungsstelle,
        { stellen: q.stellen, skizze: q.skizze },
      ).treffer.length,
    );
    expect(zahl('ein-teilnehmer')).toBe(netz.luecken.schienenMitEinemTeilnehmer.treffer.length);
    expect(zahl('leitstelle')).toBe(netz.luecken.leitstelle.fehlt ? 1 : 0);
    // Jede Stichleitung zeigt auf ein Element, jede Lücke hängt an einem vorhandenen Element.
    const keys = new Set([...netz.stellen, ...netz.schienen].map((x) => x.key));
    for (const s of netz.schienen) for (const t of s.teilnehmer) expect(keys).toContain(t.element);
    for (const l of amBild) if (l.element != null) expect(keys).toContain(l.element);
  });
});

describe('baueFernmeldenetz · Angaben für die Fläche (LFH-893 2.5)', () => {
  it('trägt Einsatz, Rechte und alle geladenen Sprechgruppen TMO vor DMO für die Palette', () => {
    const lokal = sg(9, 'TMO', 'LOKAL', true);
    const netz = baueFernmeldenetz({
      ...quellen({ sprechgruppen: daten([F314, SL_AS, lokal]) }),
      rechte: { stab: true },
    });
    expect(netz.einsatzId).toBe(7);
    expect(netz.rechte).toEqual({ stab: true });
    expect(netz.sprechgruppen.map((s) => s.id)).toEqual([3, 9, 2]);
  });

  it('ohne geladene Sprechgruppen ist die Palette leer, ohne Rechte schreibt nichts', () => {
    const netz = baueFernmeldenetz(quellen({ sprechgruppen: { zustand: 'fehler', daten: [] } }));
    expect(netz.sprechgruppen).toEqual([]);
    expect(netz.rechte).toEqual({});
  });
});

describe('baueFernmeldenetz · Führungsmittel und Funktionen im Kasten (LFH-1029)', () => {
  const ausstattung = (netz: ReturnType<typeof baueFernmeldenetz>, key: string) => {
    const s = stelleMit(netz, key);
    return s.art === 'fuehrungsstelle' || s.art === 'abschnitt'
      ? s.ausstattung.map((a) => a.text)
      : null;
  };

  it('Abschnitt mit ELW 1 und Leitung: „EAL“ vor „ELW 1“, kein Name, Einheit bleibt Element', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1, { leiter_id: 5, leiter_name: 'Erika Muster' })]),
        einheiten: daten([einheit(10, { abschnitt_id: 1, name: 'FüGr EA 1' })]),
        fahrzeuge: daten([
          fahrzeug(100, {
            einheit_id: 10,
            fahrzeugtyp: 'ELW 1',
            funkrufname: 'Florian Musterstadt 11/1',
          }),
        ]),
      }),
    );
    expect(ausstattung(netz, 'ab-1')).toEqual(['EAL', 'ELW 1']);
    const ab = stelleMit(netz, 'ab-1');
    expect(JSON.stringify(ab)).not.toContain('Erika Muster');
    expect(netz.stellen.map((s) => s.key)).toEqual(['fs', 'ab-1', 'eh-10']);
    const elw = ab.art === 'abschnitt' ? ab.ausstattung[1] : null;
    expect(elw).toMatchObject({
      art: 'fuehrungsmittel',
      titel: 'ELW 1 · Florian Musterstadt 11/1',
      zeichen: { art: 'tz', tz: { fachaufgabe: 'fuehrung' } },
    });
  });

  it('nur Führungsfahrzeuge; ein manuell gesetztes Zeichen gewinnt über den Typ', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1)]),
        einheiten: daten([einheit(10, { abschnitt_id: 1 })]),
        fahrzeuge: daten([
          fahrzeug(100, { einheit_id: 10, fahrzeugtyp: 'HLF 20' }),
          fahrzeug(101, { einheit_id: 10, fahrzeugtyp: 'MTW', tz_fachaufgabe: 'fuehrung' }),
          fahrzeug(102, { einheit_id: 10, fahrzeugtyp: 'KdoW', tz_fachaufgabe: 'logistik' }),
          fahrzeug(103, { einheit_id: 10, funkrufname: 'Kater 10/1', tz_fachaufgabe: 'fuehrung' }),
        ]),
      }),
    );
    // Folge nach Fahrzeugtyp, dann Funkrufname; ohne Typ steht der Funkrufname.
    expect(ausstattung(netz, 'ab-1')).toEqual(['Kater 10/1', 'MTW']);
  });

  it('steht im Kasten des nächsten Abschnitts über der Einheit, auch für Untereinheiten', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([
          abschnitt(1, { leiter_id: 5 }),
          abschnitt(2, { ueber_abschnitt_id: 1, leiter_id: 6 }),
        ]),
        einheiten: daten([
          einheit(10, { abschnitt_id: 1 }),
          // Ohne eigenen Abschnitt: der Baum hängt sie unter ihre Einheit, also in „ab-1“.
          einheit(11, { ueber_einheit_id: 10 }),
          einheit(20, { abschnitt_id: 2 }),
        ]),
        fahrzeuge: daten([
          fahrzeug(100, { einheit_id: 11, fahrzeugtyp: 'ELW 1' }),
          fahrzeug(200, { einheit_id: 20, fahrzeugtyp: 'KdoW' }),
        ]),
      }),
    );
    expect(ausstattung(netz, 'ab-1')).toEqual(['EAL', 'ELW 1']);
    expect(ausstattung(netz, 'ab-2')).toEqual(['UEAL', 'KdoW']);
    const alle = netz.stellen.flatMap((s) =>
      s.art === 'abschnitt' || s.art === 'fuehrungsstelle' ? s.ausstattung : [],
    );
    expect(alle.filter((a) => a.art === 'fuehrungsmittel')).toHaveLength(2);
  });

  it('Fahrzeug ohne Einheit oder in einer Einheit ohne Abschnitt erscheint in keinem Kasten', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1)]),
        einheiten: daten([einheit(10)]),
        fahrzeuge: daten([
          fahrzeug(100, { fahrzeugtyp: 'ELW 2' }),
          fahrzeug(101, { einheit_id: 10, fahrzeugtyp: 'ELW 2' }),
          fahrzeug(102, { einheit_id: 99, fahrzeugtyp: 'ELW 2' }),
        ]),
      }),
    );
    expect(ausstattung(netz, 'fs')).toEqual([]);
    expect(ausstattung(netz, 'ab-1')).toEqual([]);
  });

  it('Stab der Einsatzleitung: S-Folge, ohne rückwärtig, ohne Namen, auch ohne erfasste Stelle', () => {
    const netz = baueFernmeldenetz(
      quellen({
        besetzung: daten([
          besetzt('s6', 'rueckwaertig', 'ILS Musterhausen'),
          besetzt('s3', 'einsatzleitung'),
          besetzt('s2', 'personal', 'Max Muster'),
          besetzt('s5', 'extern', 'Pressestelle Kreis'),
        ]),
      }),
    );
    expect(ausstattung(netz, 'fs')).toEqual(['S2', 'S3', 'S5']);
    const fsStelle = stelleMit(netz, 'fs');
    expect(JSON.stringify(fsStelle)).not.toMatch(/Max Muster|Pressestelle|ILS/);
    expect(fsStelle.art === 'fuehrungsstelle' && fsStelle.ausstattung[0]).toMatchObject({
      art: 'funktion',
      titel: 'Sachgebiet S2',
      zeichen: { art: 'kuerzel', kuerzel: 'S2' },
    });
  });

  it('ein Sachgebiet, dessen Person nicht mehr disponiert ist, steht nicht im Kasten', () => {
    const netz = baueFernmeldenetz(
      quellen({
        besetzung: daten([
          besetzt('s1', 'personal', 'Max Muster'),
          { ...besetzt('s4', 'personal', 'Eva Weg'), personal_noch_disponiert: false },
        ]),
      }),
    );
    expect(ausstattung(netz, 'fs')).toEqual(['S1']);
  });

  it('Abschnitt ohne Leitung trägt keine Funktion', () => {
    const netz = baueFernmeldenetz(quellen({ abschnitte: daten([abschnitt(1)]) }));
    expect(ausstattung(netz, 'ab-1')).toEqual([]);
  });

  it('fehlende Fahrzeuge und Besetzung werden benannt und zeigen keine Zeichen', () => {
    const netz = baueFernmeldenetz(
      quellen({
        abschnitte: daten([abschnitt(1, { leiter_id: 5 })]),
        einheiten: daten([einheit(10, { abschnitt_id: 1 })]),
        // Was eine Quelle ohne Freigabe oder mit Fehler noch trägt, gilt nicht.
        fahrzeuge: {
          zustand: 'gesperrt',
          daten: [fahrzeug(100, { einheit_id: 10, fahrzeugtyp: 'ELW 1' })],
        },
        besetzung: { zustand: 'fehler', daten: [besetzt('s2', 'einsatzleitung')] },
      }),
    );
    expect(netz.fehlend.map((f) => `${f.name}: ${f.zustand}`)).toEqual([
      'Fahrzeuge: gesperrt',
      'Stab-Besetzung: fehler',
    ]);
    expect(netz.darstellbar).toBe(true);
    // Die Leitung kommt aus dem Abschnitt selbst und bleibt.
    expect(ausstattung(netz, 'ab-1')).toEqual(['EAL']);
    expect(ausstattung(netz, 'fs')).toEqual([]);
  });

  describe('Fahrzeuge der eigenen Führungsstelle (LFH-1106)', () => {
    const basis = {
      abschnitte: daten([abschnitt(1, { leiter_id: 5 })]),
      einheiten: daten([einheit(10, { abschnitt_id: 1, name: 'FüGr EL' })]),
      besetzung: daten([besetzt('s2', 'einsatzleitung')]),
      fahrzeuge: daten([
        fahrzeug(100, {
          einheit_id: 10,
          fahrzeugtyp: 'ELW 2',
          funkrufname: 'Florian Musterstadt 10/1',
        }),
        fahrzeug(101, { einheit_id: 10, fahrzeugtyp: 'ELW 1' }),
        fahrzeug(102, { fahrzeugtyp: 'MTW', funkrufname: 'Florian Musterstadt 19/1' }),
      ]),
    };

    it('ein zugeordneter ELW 2 steht im Kasten „Einsatzleitung“ und in keinem Abschnittskasten', () => {
      const netz = baueFernmeldenetz(
        quellen({ ...basis, fuehrungsstelle: fs({ fahrzeug_ids: [100] }) }),
      );
      expect(ausstattung(netz, 'fs')).toEqual(['S2', 'ELW 2']);
      expect(ausstattung(netz, 'ab-1')).toEqual(['EAL', 'ELW 1']);
      const fsStelle = stelleMit(netz, 'fs');
      expect(fsStelle.art === 'fuehrungsstelle' && fsStelle.ausstattung[1]).toMatchObject({
        art: 'fuehrungsmittel',
        schluessel: 'fz-100',
        titel: 'ELW 2 · Florian Musterstadt 10/1',
        zeichen: { art: 'tz', tz: { fachaufgabe: 'fuehrung' } },
      });
    });

    it('auch ohne Einheit und ohne Fachaufgabe Führung, sortiert nach Wort', () => {
      const netz = baueFernmeldenetz(
        quellen({ ...basis, fuehrungsstelle: fs({ fahrzeug_ids: [102, 100] }) }),
      );
      expect(ausstattung(netz, 'fs')).toEqual(['S2', 'ELW 2', 'MTW']);
      const alle = netz.stellen.flatMap((s) =>
        s.art === 'abschnitt' || s.art === 'fuehrungsstelle' ? s.ausstattung : [],
      );
      // Jedes Fahrzeug höchstens einmal im Bild.
      const schluessel = alle.filter((a) => a.art === 'fuehrungsmittel').map((a) => a.schluessel);
      expect(new Set(schluessel).size).toBe(schluessel.length);
    });

    it('ohne Zuordnung bleibt der Kasten wie bisher; eine veraltete ID fällt weg', () => {
      const ohne = baueFernmeldenetz(quellen({ ...basis, fuehrungsstelle: fs() }));
      expect(ausstattung(ohne, 'fs')).toEqual(['S2']);
      expect(ausstattung(ohne, 'ab-1')).toEqual(['EAL', 'ELW 1', 'ELW 2']);
      const veraltet = baueFernmeldenetz(
        quellen({ ...basis, fuehrungsstelle: fs({ fahrzeug_ids: [999] }) }),
      );
      expect(ausstattung(veraltet, 'fs')).toEqual(['S2']);
    });

    it('ohne Freigabe der Fahrzeuge steht kein Fahrzeugzeichen im Kasten', () => {
      const netz = baueFernmeldenetz(
        quellen({
          ...basis,
          fahrzeuge: { zustand: 'gesperrt', daten: basis.fahrzeuge.daten },
          fuehrungsstelle: fs({ fahrzeug_ids: [100] }),
        }),
      );
      expect(ausstattung(netz, 'fs')).toEqual(['S2']);
    });
  });
});
