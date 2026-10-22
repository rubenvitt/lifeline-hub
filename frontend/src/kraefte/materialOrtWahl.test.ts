import { describe, expect, it } from 'vitest';
import type { Einheit, EinsatzMaterial, ModulFreigaben } from '../api/types';
import { buildEinheitOptions } from './kraeftebaumKern';
import type { OrtNamen } from './materialPosten';
import {
  buildOrtGruppierung,
  buildOrtOptions,
  buildZuordnenOptions,
  ortFilter,
  zuordnenLeerText,
  type OrtOption,
  type OrtOptionGruppe,
  type OrtWahlQuellen,
} from './materialOrtWahl';

const einheiten = buildEinheitOptions(
  [
    { id: 1, name: 'Zug 1', ueber_einheit_id: null, abschnitt_id: null },
    { id: 2, name: 'Staffel A', ueber_einheit_id: 1, abschnitt_id: null },
    { id: 3, name: 'Aufgelöst', ueber_einheit_id: null, aufgeloest_at: '2026-10-14 10:00:00' },
  ] as Einheit[],
  [],
);

const quellen: OrtWahlQuellen = {
  einheiten,
  fahrzeuge: [
    { id: 5, funkrufname: 'Florian 2', beendet_at: null },
    { id: 4, funkrufname: 'Florian 1', beendet_at: null },
    { id: 6, funkrufname: 'Florian alt', beendet_at: '2026-10-14 10:00:00' },
  ],
  uhs: [
    { id: 7, bezeichnung: 'Turnhalle', status: 'aktiv', storniert_at: null },
    { id: 8, bezeichnung: 'UHS Schule', status: 'geplant', storniert_at: null },
    { id: 9, bezeichnung: 'Zelt', status: 'aufgeloest', storniert_at: null },
    { id: 10, bezeichnung: 'Fehler', status: 'geplant', storniert_at: '2026-10-14 10:00:00' },
  ],
  br: [
    { id: 2, bezeichnung: 'BR Süd', status: 'aktiv', storniert_at: null },
    { id: 1, bezeichnung: 'BR Nord', status: 'geplant', storniert_at: null },
    { id: 3, bezeichnung: 'BR Ost', status: 'aufgeloest', storniert_at: null },
  ],
};

const gruppe = (opts: (OrtOption | OrtOptionGruppe)[], label: string) =>
  opts.find((o): o is OrtOptionGruppe => 'options' in o && o.label === label);
const flach = (opts: (OrtOption | OrtOptionGruppe)[]) =>
  opts.map((o) =>
    'options' in o ? `${o.label}: ${o.options.map((x) => x.label).join(', ')}` : o.label,
  );

describe('buildOrtOptions (LLH-1225 D3)', () => {
  it('„ohne Ort“ zuerst, dann Einheiten, Fahrzeuge, UHS und Bereitstellungsräume', () => {
    expect(flach(buildOrtOptions(quellen))).toEqual([
      'ohne Ort',
      'Einheiten: Zug 1, Zug 1 › Staffel A',
      'Fahrzeuge: Florian 1, Florian 2',
      'Unfallhilfsstellen: UHS Schule, UHS Turnhalle',
      'Bereitstellungsräume: BR Nord, BR Süd',
    ]);
  });

  it('die Werte tragen die Ortsart, weil IDs kollidieren', () => {
    const opts = buildOrtOptions(quellen);
    expect(opts[0]).toMatchObject({ value: 'ohne' });
    expect(gruppe(opts, 'Einheiten')!.options[1].value).toBe('einheit:2');
    expect(gruppe(opts, 'Fahrzeuge')!.options[0].value).toBe('fahrzeug:4');
    expect(gruppe(opts, 'Unfallhilfsstellen')!.options[1].value).toBe('uhs:7');
    expect(gruppe(opts, 'Bereitstellungsräume')!.options[0].value).toBe('br:1');
  });

  it('eine Gruppe fehlt ohne Leserecht auf ihr Modul; unbekannte Freigabe heißt offen', () => {
    const freigaben = {
      bereitstellungsraeume: { zugriff: false },
      fahrzeuge: { zugriff: true },
    } as unknown as ModulFreigaben;
    const opts = buildOrtOptions({ ...quellen, freigaben });
    expect(gruppe(opts, 'Bereitstellungsräume')).toBeUndefined();
    expect(gruppe(opts, 'Fahrzeuge')).toBeDefined();
    expect(gruppe(opts, 'Einheiten')).toBeDefined();
    expect(gruppe(opts, 'Unfallhilfsstellen')).toBeDefined();
  });

  it('eine nicht geladene oder leere Liste gibt keine Gruppe', () => {
    expect(flach(buildOrtOptions({ uhs: [] }))).toEqual(['ohne Ort']);
  });

  it('ein aktueller Ort, der nicht mehr wählbar ist, steht gesperrt vorn mit seinem Namen', () => {
    const opts = buildOrtOptions(quellen, { ort: { art: 'uhs', id: 9 }, text: 'UHS Zelt' });
    expect(opts[0]).toEqual({ value: 'uhs:9', label: 'UHS Zelt', disabled: true });
    expect(opts[1]).toMatchObject({ value: 'ohne' });
    // Ein wählbarer aktueller Ort steht nur einmal, an seinem Platz.
    const wählbar = buildOrtOptions(quellen, { ort: { art: 'uhs', id: 7 }, text: 'UHS Turnhalle' });
    expect(wählbar[0]).toMatchObject({ value: 'ohne' });
  });
});

const namen: OrtNamen = {
  einheit: (id) => ({ 1: 'Zug 1', 2: 'Staffel A' })[id],
  fahrzeug: (id) => (id === 4 ? 'Florian 1' : undefined),
  uhs: (id) => (id === 7 ? 'Turnhalle' : undefined),
  bereitstellungsraum: (id) => (id === 1 ? 'BR Nord' : undefined),
};
const posten = [
  { einheit_id: 2 },
  { einheit_id: null, uhs_id: null },
  { einheit_id: 1 },
  { uhs_id: 7 },
  { einsatz_fahrzeug_id: 4 },
  { br_id: 1 },
];

describe('ortFilter (Spec material-liste, „Ort eines Postens“)', () => {
  it('kennt „ohne Ort“ und je Ort einen Wert; ein Posten trifft genau einen', () => {
    const filter = ortFilter(posten, namen);
    expect(filter.werte.map((w) => w.text)).toEqual([
      'ohne Ort',
      'Staffel A',
      'Zug 1',
      'Florian 1',
      'UHS Turnhalle',
      'BR Nord',
    ]);
    expect(filter.werte.map((w) => w.value)).toContain('br:1');
    for (const p of posten) {
      const treffer = filter.werte.filter((w) => filter.trifft(p, w.value));
      expect(treffer, JSON.stringify(p)).toHaveLength(1);
    }
  });

  it('ohne Leserecht fasst ein Wert „Einheit zugeordnet“ alle Einheiten zusammen', () => {
    const filter = ortFilter([{ einheit_id: 2 }, { einheit_id: 1 }], {});
    expect(filter.werte).toEqual([
      { value: 'ohne', text: 'ohne Ort' },
      { value: 'einheit:*', text: 'Einheit zugeordnet' },
    ]);
    expect(filter.trifft({ einheit_id: 1 }, 'einheit:*')).toBe(true);
  });
});

describe('buildOrtGruppierung (LLH-1225 D4)', () => {
  it('Folge: Einheiten in Baumfolge, Fahrzeuge, UHS, BR, „ohne Ort“ zuletzt', () => {
    const g = buildOrtGruppierung(posten, namen, einheiten);
    expect(g.reihenfolge).toEqual([
      'einheit:1',
      'einheit:2',
      'fahrzeug:4',
      'uhs:7',
      'br:1',
      'ohne',
    ]);
    expect(g.reihenfolge.map((w) => g.etikett(w))).toEqual([
      'Zug 1',
      'Staffel A',
      'Florian 1',
      'UHS Turnhalle',
      'BR Nord',
      'ohne Ort',
    ]);
  });

  it('jeder Posten steht in genau einer Gruppe, mit dem Schlüssel des Filters', () => {
    const g = buildOrtGruppierung(posten, namen, einheiten);
    const filter = ortFilter(posten, namen);
    for (const p of posten) expect(filter.trifft(p, g.schluessel(p))).toBe(true);
  });

  it('ohne Leserecht eine Gruppe „Einheit zugeordnet“ je Ortsart', () => {
    const g = buildOrtGruppierung([{ einheit_id: 2 }, { einheit_id: 1 }, {}], {}, []);
    expect(g.reihenfolge).toEqual(['einheit:*', 'ohne']);
    expect(g.etikett('einheit:*')).toBe('Einheit zugeordnet');
  });
});

describe('buildZuordnenOptions (LLH-1225 D8)', () => {
  const em = (p: Partial<EinsatzMaterial>): EinsatzMaterial =>
    ({
      id: 0,
      bezeichnung: 'Posten',
      art: 'geraet',
      menge: 1,
      ausgegeben: 0,
      status: 'einsatzbereit',
      einheit_id: null,
      einsatz_fahrzeug_id: null,
      uhs_id: null,
      br_id: null,
      beendet_at: null,
      ...p,
    }) as EinsatzMaterial;
  const material = [
    em({
      id: 1,
      bezeichnung: 'Wolldecke',
      art: 'verbrauchsgut',
      menge: 50,
      ausgegeben: 20,
      einheit_id: 2,
    }),
    em({ id: 2, bezeichnung: 'Trage' }),
    em({ id: 3, bezeichnung: 'Stromerzeuger', einsatz_fahrzeug_id: 4 }),
    em({ id: 4, bezeichnung: 'Feldbett', uhs_id: 7 }),
    em({ id: 5, bezeichnung: 'Beleuchtung', art: 'verbrauchsgut', menge: 3 }),
    em({ id: 6, bezeichnung: 'Alt', beendet_at: '2026-10-14 10:00:00' }),
  ];
  const namenAlle: OrtNamen = {
    einheit: (id) => (id === 2 ? 'Staffel A' : undefined),
    fahrzeug: (id) => (id === 4 ? 'Florian 1' : undefined),
    uhs: (id) => (id === 7 ? 'Turnhalle' : undefined),
  };

  it('Gruppen „Ohne Ort“ und „An anderem Ort“, der Ort im Etikett, nach Bezeichnung', () => {
    const opts = buildZuordnenOptions(material, { art: 'uhs', id: 9 }, namenAlle);
    expect(flach(opts)).toEqual([
      'Ohne Ort: Beleuchtung · 3, Trage · 1',
      'An anderem Ort: Feldbett · 1 · UHS Turnhalle, Stromerzeuger · 1 · Florian 1, Wolldecke · 30 von 50 übrig · Staffel A',
    ]);
    expect(gruppe(opts, 'Ohne Ort')!.options.map((o) => o.value)).toEqual(['5', '2']);
  });

  it('die Posten dieses Orts und herausgenommene fehlen', () => {
    const opts = buildZuordnenOptions(material, { art: 'uhs', id: 7 }, namenAlle);
    const alle = opts.flatMap((g) => g.options.map((o) => o.label));
    expect(alle.some((l) => l.startsWith('Feldbett'))).toBe(false);
    expect(alle.some((l) => l.startsWith('Alt'))).toBe(false);
  });

  it('ohne Leserecht auf den anderen Ort steht „zugeordnet“', () => {
    const opts = buildZuordnenOptions(material, { art: 'bereitstellungsraum', id: 1 }, {});
    expect(gruppe(opts, 'An anderem Ort')!.options.map((o) => o.label)).toContain(
      'Stromerzeuger · 1 · zugeordnet',
    );
  });

  it('eine leere Gruppe fehlt; nichts anzubieten heißt keine Gruppe', () => {
    const nurHier = [em({ id: 1, bezeichnung: 'Trage', uhs_id: 7 })];
    expect(buildZuordnenOptions(nurHier, { art: 'uhs', id: 7 }, namenAlle)).toEqual([]);
    expect(flach(buildZuordnenOptions([em({ id: 2 })], { art: 'uhs', id: 7 }, {}))).toEqual([
      'Ohne Ort: Posten · 1',
    ]);
  });
});

describe('zuordnenLeerText (LLH-1255)', () => {
  const em = (p: Partial<EinsatzMaterial>): EinsatzMaterial =>
    ({
      id: 0,
      bezeichnung: 'Posten',
      art: 'geraet',
      menge: 1,
      ausgegeben: 0,
      status: 'einsatzbereit',
      einheit_id: null,
      einsatz_fahrzeug_id: null,
      uhs_id: null,
      br_id: null,
      beendet_at: null,
      ...p,
    }) as EinsatzMaterial;

  it('alles laufende Material liegt hier: „Kein anderes Material“', () => {
    expect(zuordnenLeerText([em({ id: 1, uhs_id: 7 })])).toBe('Kein anderes Material');
  });

  it('kein laufendes Material im Einsatz: „Kein Material im Einsatz“, nie „ohne Ort“', () => {
    expect(zuordnenLeerText([])).toBe('Kein Material im Einsatz');
    expect(zuordnenLeerText([em({ id: 2, beendet_at: '2026-10-20 10:00:00' })])).toBe(
      'Kein Material im Einsatz',
    );
  });
});
