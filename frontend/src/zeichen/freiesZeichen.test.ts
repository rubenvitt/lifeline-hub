import { drawAnySpec, serializeAnySpec } from '@einsatzzeichen/core';
import type { AnySpec, SymbolSpec, TechnicalFillToken } from '@einsatzzeichen/schema';
import { describe, expect, it } from 'vitest';
import { freiesZeichen, naechstesFarbtoken, type FreiesZeichenEingabe } from './freiesZeichen';

// Abbildung der Alt-Kennungen freier Zeichen (Katalog taktische-zeichen-core 0.10) auf
// @einsatzzeichen 5.2 (LFH-836, openspec/changes/lfh-836-freie-zeichen-einsatzzeichen/design.md D5,
// D6). Jede Zeile zeichnet echt: ein Bibliotheks-Update, das eine Abbildung verschiebt, wird hier
// rot statt im Betrieb still zum Rückfall.
//
// Kategorien je Zeile:
// - `exakt`: das Altzeichen hat einen Nachfolger, alle gespeicherten Merkmale sind im Bild.
// - `naeherung`: alle Merkmale sind im Bild, aber über einen benannten Ersatz (D5).
// - `kaskade`: ein Merkmal hat keinen Nachfolger oder zeichnet nicht; es entfällt (`vereinfacht`).
// - `platzhalter`: nichts zeichnet; der Punkt steht für das Zeichen (`vereinfacht`).
type Kategorie = 'exakt' | 'naeherung' | 'kaskade' | 'platzhalter';
type Teil = Partial<SymbolSpec>;

const PUNKT: SymbolSpec = { kind: 'point' };

function pruefe(eingabe: FreiesZeichenEingabe, erwartet: AnySpec, kategorie: Kategorie) {
  const z = freiesZeichen(eingabe);
  expect(z.spec, JSON.stringify(eingabe)).toEqual(erwartet);
  expect(() => drawAnySpec(z.spec)).not.toThrow();
  expect(z.schluessel).toBe(`ez|${serializeAnySpec(z.spec)}`);
  expect(z.vereinfacht, `vereinfacht bei ${JSON.stringify(eingabe)}`).toBe(
    kategorie === 'kaskade' || kategorie === 'platzhalter',
  );
  if (kategorie === 'platzhalter') expect(z.spec).toEqual(PUNKT);
}

// ---------------------------------------------------------------------------------------------
// Grundzeichen (36)
// ---------------------------------------------------------------------------------------------

const GRUNDZEICHEN: Array<[string, SymbolSpec, Kategorie]> = [
  // „Kein Grundzeichen“ ohne Symbol ist kein Zeichen.
  ['ohne', PUNKT, 'platzhalter'],
  ['taktische-formation', { kind: 'formation' }, 'exakt'],
  // Fahnenstock der Befehlsstelle ohne Abbildung (LFH-1293).
  ['befehlsstelle', { kind: 'formation', organization: 'fuehrung-leitung' }, 'naeherung'],
  ['stelle', { kind: 'circle-12' }, 'exakt'],
  ['ortsfeste-stelle', { kind: 'circle-12', bodyVariant: 'raised-gable' }, 'exakt'],
  ['person', { kind: 'person' }, 'exakt'],
  ['gebaeude', { kind: 'building' }, 'exakt'],
  ['fahrzeug', { kind: 'vehicle-land' }, 'exakt'],
  [
    'kraftfahrzeug-landgebunden',
    { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-1' },
    'exakt',
  ],
  [
    'kraftfahrzeug-gelaendegaengig',
    { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-2' },
    'exakt',
  ],
  [
    'kraftfahrzeug-gelaendegaengig-kategorie3',
    { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-3' },
    'exakt',
  ],
  ['amphibienfahrzeug', { kind: 'vehicle-land', vehicleCategory: 'amphibienfahrzeug' }, 'exakt'],
  ['wechsellader', { kind: 'swap-loader-vehicle', vehicleCategory: 'kfz-kategorie-1' }, 'exakt'],
  // Behälter-Familie ohne Aufbau (LFH-831).
  [
    'wechsellader-wechselbehaelter',
    { kind: 'swap-loader-vehicle', vehicleCategory: 'kfz-kategorie-1' },
    'naeherung',
  ],
  ['abrollbehaelter', { kind: 'swap-loader-vehicle' }, 'naeherung'],
  ['wechselbehaelter', { kind: 'swap-loader-vehicle' }, 'naeherung'],
  ['wechselbruecke', { kind: 'swap-loader-vehicle' }, 'naeherung'],
  ['rollcontainer', { kind: 'swap-loader-vehicle' }, 'naeherung'],
  ['anhaenger', { kind: 'trailer' }, 'exakt'],
  [
    'anhaenger-abrollbehaelter',
    { kind: 'trailer', vehicleCategory: 'kfz-kategorie-1' },
    'naeherung',
  ],
  [
    'anhaenger-wechselbehaelter',
    { kind: 'trailer', vehicleCategory: 'kfz-kategorie-1' },
    'naeherung',
  ],
  ['anhaenger-pkw', { kind: 'trailer', vehicleCategory: 'anhaenger-ein-rad' }, 'exakt'],
  ['anhaenger-lkw', { kind: 'trailer', vehicleCategory: 'anhaenger-zwei-raeder' }, 'exakt'],
  ['schienenfahrzeug', { kind: 'vehicle-land', vehicleCategory: 'schienenfahrzeug' }, 'exakt'],
  ['kettenfahrzeug', { kind: 'vehicle-land', vehicleCategory: 'kettenfahrzeug' }, 'exakt'],
  // Zweirad, Krad, Fahrrad haben keinen Körper (LFH-1298).
  ['fahrrad', { kind: 'vehicle-land' }, 'naeherung'],
  ['kraftrad', { kind: 'vehicle-land' }, 'naeherung'],
  ['zweirad', { kind: 'vehicle-land' }, 'naeherung'],
  ['wasserfahrzeug', { kind: 'vehicle-water' }, 'exakt'],
  ['flugzeug', { kind: 'vehicle-air', bodyVariant: 'fixed-wing-hull' }, 'exakt'],
  ['hubschrauber', { kind: 'vehicle-air' }, 'exakt'],
  ['massnahme', { kind: 'measure' }, 'exakt'],
  ['anlass', { kind: 'event' }, 'exakt'],
  ['gefahr', { kind: 'hazard' }, 'exakt'],
  ['gefahr-vermutet', { kind: 'hazard', states: ['suspected-situation'] }, 'exakt'],
  ['gefahr-akut', { kind: 'hazard', states: ['acute-situation'] }, 'exakt'],
];

describe('freiesZeichen — Grundzeichen (D5)', () => {
  it('deckt alle 36 Grundzeichen des Altkatalogs ab', () => {
    expect(GRUNDZEICHEN).toHaveLength(36);
  });

  it.each(GRUNDZEICHEN)('%s', (grundzeichen, erwartet, kategorie) => {
    pruefe({ grundzeichen }, erwartet, kategorie);
  });

  it('fällt bei einem unbekannten Grundzeichen auf den Platzhalter', () => {
    pruefe({ grundzeichen: 'gibt-es-nicht' }, PUNKT, 'platzhalter');
  });

  it('fällt ohne jede Angabe auf den Platzhalter', () => {
    pruefe({}, PUNKT, 'platzhalter');
  });
});

// ---------------------------------------------------------------------------------------------
// Symbole (84): frei (Grundzeichen „ohne“) und im Grundzeichen Stelle, Gefahr, Maßnahme
// ---------------------------------------------------------------------------------------------

// Je Symbol: die freistehende Spec (null = kein Nachfolger → Platzhalter), der Teil im
// Grundzeichen (null = entfällt → Kaskade) und ob die Abbildung eine Näherung ist.
interface SymbolErwartung {
  frei: AnySpec | null;
  imKoerper: Teil | null;
  naeherung?: true;
}

const C = (c: NonNullable<SymbolSpec['capabilities']>[number]): Teil => ({ bodyMarks: [c] });
const S = (s: NonNullable<SymbolSpec['states']>[number]): Teil => ({ states: [s] });
const PIKTO = (c: string): AnySpec =>
  ({ kind: 'pictogram', pictogram: `capability.${c}` }) as AnySpec;
const ZUSTAND = (s: string): AnySpec => ({ kind: 'state', state: s }) as AnySpec;
const COMMS = (p: string, draht: boolean): AnySpec =>
  (draht
    ? { kind: 'pictogram', pictogram: `comms.${p}`, variant: 'alternative' }
    : { kind: 'pictogram', pictogram: `comms.${p}` }) as AnySpec;
const faehig = (c: Parameters<typeof C>[0], naeherung?: true): SymbolErwartung => ({
  frei: PIKTO(c),
  imKoerper: C(c),
  ...(naeherung ? { naeherung } : {}),
});
const zustand = (s: Parameters<typeof S>[0], naeherung?: true): SymbolErwartung => ({
  frei: ZUSTAND(s),
  imKoerper: S(s),
  ...(naeherung ? { naeherung } : {}),
});
// Personenzustände: freistehend nach `freestandingRedirect` an der Person; im Grundzeichen
// Stelle, Gefahr, Maßnahme lehnt die Bibliothek sie ab (state-carrier-not-allowed).
const personZustand = (s: Parameters<typeof S>[0], naeherung?: true): SymbolErwartung => ({
  frei: { kind: 'person', states: [s] },
  imKoerper: null,
  ...(naeherung ? { naeherung } : {}),
});
// Ein Grundzeichen als Symbol: freistehend als Körper („Körper statt Piktogramm“), im
// Grundzeichen entfällt es (Entscheidung der Bibliothek vom 10.10.2026, Punkt 5).
const koerper = (k: SymbolSpec): SymbolErwartung => ({ frei: k, imKoerper: null, naeherung: true });
const ohneNachfolger: SymbolErwartung = { frei: null, imKoerper: null };

const SYMBOLE: Record<string, SymbolErwartung> = {
  drehleiter: faehig('rescue-aerial-ladder'),
  hebegeraet: faehig('crane-lifting'),
  bagger: faehig('excavation'),
  raeumgeraet: faehig('mechanized-clearing'),
  bruecke: faehig('bridge'),
  sprengmittel: zustand('explosive-ordnance-hazard', true),
  beleuchtung: faehig('lighting'),
  bett: faehig('temporary-accommodation-resting'),
  verpflegung: faehig('catering'),
  verbrauchsgueter: faehig('fuels-consumables'),
  trinkwasser: faehig('drinking-water'),
  brauchwasser: faehig('service-water'),
  elektrizitaet: faehig('power-supply'),
  // Kein Nachfolger; „Handwerkzeug“ ist die klarste Fähigkeit (Abgleich 10.10.2026).
  geraete: faehig('hand-tools', true),
  sprengung: faehig('blasting'),
  transport: faehig('transport'),
  fahrzeug: koerper({ kind: 'vehicle-land' }),
  fahrrad: koerper({ kind: 'vehicle-land' }),
  kraftrad: koerper({ kind: 'vehicle-land' }),
  zweirad: koerper({ kind: 'vehicle-land' }),
  flugzeug: koerper({ kind: 'vehicle-air', bodyVariant: 'fixed-wing-hull' }),
  hubschrauber: koerper({ kind: 'vehicle-air' }),
  entstehungsbrand: zustand('incipient-fire'),
  'fortentwickelter-brand': zustand('developed-fire'),
  vollbrand: zustand('fully-developed-fire'),
  sirene: faehig('siren-warning'),
  lautsprecher: faehig('loudspeaker-warning'),
  // Bildtreu: das Altpaket zeichnete einen Lautsprecher mit Schallbögen.
  warnung: faehig('loudspeaker-warning', true),
  // Bildtreu: das Altpaket zeichnete ein Dreieck mit gekreuzten Stangen (4.8.16).
  zelt: faehig('frame-tent', true),
  sichten: ohneNachfolger,
  // Technische Körpermarke F.3.6; freistehend nur als Pfeil mit Verlauf (gehört zum Zeichnen).
  sammeln: { frei: null, imKoerper: { bodyMarks: ['circle-collection-arrow'] } },
  // Bildtreu F.3.12 (Doppelpfeil, Stiel, V).
  'sammelplatz-betroffene': {
    frei: null,
    imKoerper: { bodyMarks: ['circle-double-arrow-lower-v'] },
  },
  veterinaerwesen: faehig('veterinary'),
  schlachten: faehig('slaughter-culling'),
  // Tierzustände: freistehend als `animal-state`, im Grundzeichen nicht anhängbar.
  'tier-verletzt': {
    frei: { kind: 'animal-state', state: 'sick-animal' },
    imKoerper: null,
    naeherung: true,
  },
  'tier-tot': { frei: { kind: 'animal-state', state: 'dead-animal' }, imKoerper: null },
  person: koerper({ kind: 'person' }),
  'person-verletzt': personZustand('person-injured'),
  'person-tot': personZustand('person-dead'),
  'person-vermisst': personZustand('person-missing'),
  'person-verschuettet': personZustand('person-in-distress', true),
  'person-gerettet': personZustand('person-rescued'),
  'person-zu-transportieren': personZustand('person-to-be-transported'),
  'person-transportiert': personZustand('person-transported'),
  beschaedigt: zustand('damaged'),
  teilzerstoert: zustand('partially-destroyed'),
  zerstoert: zustand('destroyed'),
  teilblockiert: zustand('route-difficult-to-pass'),
  blockiert: zustand('route-impassable'),
  'tendenz-steigend': {
    frei: ZUSTAND('tendency-rising'),
    imKoerper: { tendency: 'tendency-rising' },
  },
  'tendenz-fallend': {
    frei: ZUSTAND('tendency-falling'),
    imKoerper: { tendency: 'tendency-falling' },
  },
  'tendenz-unveraendert': {
    frei: ZUSTAND('tendency-unchanged'),
    imKoerper: { tendency: 'tendency-unchanged' },
  },
  'ausfall-25': zustand('activity-slightly-increased-outage-up-to-25-percent'),
  'ausfall-50': zustand('activity-moderately-increased-outage-up-to-50-percent'),
  'ausfall-75': zustand('activity-significantly-increased-outage-up-to-75-percent'),
  'ausfall-100': zustand('activity-strongly-increased-total-outage'),
  // Mehrdeutig, bildtreu: das Altpaket zeichnete 4.1.1 (ABC-Schutz), auch in der Gefahr.
  abc: faehig('cbrn-protection'),
  dekontamination: faehig('decontamination'),
  // Der Zusatz P/G ginge nur als Beschriftung, die eine Spec nicht tragen darf (D3).
  'dekontamination-personen': faehig('decontamination', true),
  'dekontamination-geraete': faehig('decontamination', true),
  // Bildtreu: zwei Wellenlinien, wie in 4.7.1.
  wasser: faehig('water-hazard-control', true),
  wasserfahrzeug: koerper({ kind: 'vehicle-water' }),
  pumpe: faehig('pumping'),
  // Anhang J: leitergebunden („Draht“) ist die zweite Darstellung, Funk die erste.
  bilduebertragung: { frei: COMMS('image-transmission', true), imKoerper: null },
  'bilduebertragung-funk': { frei: COMMS('image-transmission', false), imKoerper: null },
  datenuebertragung: { frei: COMMS('data-transmission', true), imKoerper: null },
  'datenuebertragung-funk': { frei: COMMS('data-transmission', false), imKoerper: null },
  fax: { frei: COMMS('fax-transmission', true), imKoerper: null },
  'fax-funk': { frei: COMMS('fax-transmission', false), imKoerper: null },
  fernsprechen: { frei: COMMS('voice', true), imKoerper: null },
  'fernsprechen-funk': { frei: COMMS('voice', false), imKoerper: null },
  fernschreiben: ohneNachfolger,
  'fernschreiben-funk': ohneNachfolger,
  festbilduebertragung: ohneNachfolger,
  'festbilduebertragung-funk': ohneNachfolger,
  relaisfunkbetrieb: {
    frei: { kind: 'pictogram', pictogram: 'comms.voice-radio-dmo-repeater' },
    imKoerper: null,
  },
  richtbetrieb: { frei: COMMS('directional-radio', false), imKoerper: null },
  kabelbau: { frei: COMMS('cable-construction', false), imKoerper: null },
  vermutung: zustand('suspected-situation'),
  akut: zustand('acute-situation'),
  'technische-hilfeleistung': faehig('technical-assistance'),
  bergung: faehig('recovery'),
  seelsorge: faehig('pastoral-care'),
  drohne: ohneNachfolger,
};

describe('freiesZeichen — Symbole frei, Grundzeichen „ohne“ (D5)', () => {
  it('deckt alle 84 Symbole des Altkatalogs ab', () => {
    expect(Object.keys(SYMBOLE)).toHaveLength(84);
  });

  it.each(Object.entries(SYMBOLE))('%s', (symbol, e) => {
    pruefe(
      { grundzeichen: 'ohne', symbol },
      e.frei ?? PUNKT,
      e.frei === null ? 'platzhalter' : e.naeherung ? 'naeherung' : 'exakt',
    );
  });

  it('liest ein freies Symbol auch ohne gespeichertes Grundzeichen', () => {
    pruefe({ symbol: 'drehleiter' }, PIKTO('rescue-aerial-ladder'), 'exakt');
  });

  it('fällt bei einem unbekannten Symbol auf den Platzhalter', () => {
    pruefe({ grundzeichen: 'ohne', symbol: 'gibt-es-nicht' }, PUNKT, 'platzhalter');
  });
});

// Die Träger mit Symbol und ihr Körper.
const TRAEGER: Array<[string, SymbolSpec]> = [
  ['stelle', { kind: 'circle-12' }],
  ['gefahr', { kind: 'hazard' }],
  ['massnahme', { kind: 'measure' }],
];

const IM_GRUNDZEICHEN = TRAEGER.flatMap(([gz, k]) =>
  Object.entries(SYMBOLE).map(([symbol, e]): [string, string, SymbolSpec, Kategorie] => [
    gz,
    symbol,
    e.imKoerper ? ({ ...k, ...e.imKoerper } as SymbolSpec) : k,
    e.imKoerper === null ? 'kaskade' : e.naeherung ? 'naeherung' : 'exakt',
  ]),
);

describe('freiesZeichen — Symbole im Grundzeichen Stelle, Gefahr, Maßnahme (D5)', () => {
  it.each(IM_GRUNDZEICHEN)('%s mit %s', (grundzeichen, symbol, erwartet, kategorie) => {
    pruefe({ grundzeichen, symbol }, erwartet, kategorie);
  });

  it('hängt den Zustand an den Hinweis der vermuteten Gefahr an', () => {
    pruefe(
      { grundzeichen: 'gefahr-vermutet', symbol: 'vollbrand' },
      { kind: 'hazard', states: ['suspected-situation', 'fully-developed-fire'] },
      'exakt',
    );
  });

  it('lässt einen zweiten Hinweis an der vermuteten Gefahr weg (state-hint-limit-exceeded)', () => {
    pruefe(
      { grundzeichen: 'gefahr-vermutet', symbol: 'akut' },
      { kind: 'hazard', states: ['suspected-situation'] },
      'kaskade',
    );
  });

  it('zeichnet den Personenzustand an der Person', () => {
    pruefe(
      { grundzeichen: 'person', symbol: 'person-vermisst', organisation: 'polizei' },
      { kind: 'person', organization: 'polizei', states: ['person-missing'] },
      'exakt',
    );
  });

  it('ignoriert ein Symbol an einem Grundzeichen, das keins annahm (Altkatalog)', () => {
    // Das Altpaket zeichnete am Hubschrauber kein Symbol; die Bibliothek darf es auch nicht.
    pruefe(
      { grundzeichen: 'hubschrauber', symbol: 'drehleiter' },
      { kind: 'vehicle-air' },
      'exakt',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Organisationen (8), Fachaufgaben (42), Einheiten (8), Funktionen (2)
// ---------------------------------------------------------------------------------------------

const ORGANISATIONEN: Array<[string, NonNullable<SymbolSpec['organization']>]> = [
  ['feuerwehr', 'feuerwehr'],
  ['thw', 'thw'],
  ['fuehrung', 'fuehrung-leitung'],
  ['polizei', 'polizei'],
  ['gefahrenabwehr', 'sonstige-gefahrenabwehr'],
  ['hilfsorganisation', 'hilfsorganisation'],
  ['bundeswehr', 'bundeswehr'],
  ['zivil', 'zivile-einheiten'],
];

describe('freiesZeichen — Organisationen (D5)', () => {
  it.each(ORGANISATIONEN)('%s an der Formation', (organisation, neu) => {
    pruefe(
      { grundzeichen: 'taktische-formation', organisation },
      { kind: 'formation', organization: neu },
      'exakt',
    );
  });

  it('färbt die Stelle in der gespeicherten Organisation (keine feste Hilfsorganisation)', () => {
    pruefe(
      { grundzeichen: 'stelle', organisation: 'thw' },
      { kind: 'circle-12', organization: 'thw' },
      'exakt',
    );
  });

  it('überstimmt die Organisation an der Befehlsstelle mit Führung und Leitung', () => {
    pruefe(
      { grundzeichen: 'befehlsstelle', organisation: 'feuerwehr' },
      { kind: 'formation', organization: 'fuehrung-leitung' },
      'naeherung',
    );
  });

  it('lässt eine unbekannte Organisation weg', () => {
    pruefe(
      { grundzeichen: 'taktische-formation', organisation: 'quatsch', einheit: 'zug' },
      { kind: 'formation', strength: 'zug' },
      'kaskade',
    );
  });
});

// Fachaufgabe an der Formation: Tabelle aus `fachobjektZeichen` (LFH-835), randbündig vor Box,
// vermessen vor abgeleitet.
const FACHAUFGABEN: Array<[string, Teil | null]> = [
  ['brandbekaempfung', { bodyMarks: ['fire-fighting'] }],
  ['hoehenrettung', { bodyMarks: ['rescue-aerial-ladder'] }],
  ['wasserversorgung', { capabilities: ['water-conveyance'] }],
  ['technische-hilfeleistung', { bodyMarks: ['technical-assistance'] }],
  ['heben', { bodyMarks: ['crane-lifting'] }],
  ['bergung', { capabilities: ['recovery'] }],
  ['raeumen', { capabilities: ['mechanized-clearing'] }],
  ['entschaerfen', { bodyMarks: ['explosive-ordnance-clearance'] }],
  ['sprengen', { bodyMarks: ['blasting'] }],
  ['beleuchtung', { bodyMarks: ['lighting'] }],
  ['transport', { bodyMarks: ['transport'] }],
  ['abc', { bodyMarks: ['cbrn-protection'] }],
  ['messen', { bodyMarks: ['cbrn-detection'] }],
  ['dekontamination', { bodyMarks: ['decontamination'] }],
  ['dekontamination-personen', { bodyMarks: ['decontamination'] }],
  ['dekontamination-geraete', { bodyMarks: ['decontamination'] }],
  ['umweltschaeden-gewaesser', { bodyMarks: ['water-environmental-damage-control'] }],
  ['rettungswesen', { bodyMarks: ['medical-service'] }],
  ['aerztliche-versorgung', { bodyMarks: ['physician'] }],
  ['krankenhaus', { bodyMarks: ['hospital'] }],
  ['einsatzeinheit', { bodyMarks: ['medical-service', 'care'] }],
  ['betreuung', { bodyMarks: ['care'] }],
  ['seelsorge', { bodyMarks: ['pastoral-care'] }],
  ['unterbringung', { bodyMarks: ['temporary-accommodation-resting'] }],
  ['logistik', { bodyVariant: 'foot-band' }],
  ['verpflegung', { bodyVariant: 'foot-band', bodyMarks: ['catering'] }],
  ['verbrauchsgueter', { bodyVariant: 'foot-band', bodyMarks: ['fuels-consumables'] }],
  ['versorgung-trinkwasser', { capabilities: ['drinking-water'] }],
  ['versorgung-brauchwasser', { capabilities: ['service-water'] }],
  ['versorgung-elektrizitaet', { bodyVariant: 'foot-band', bodyMarks: ['power-supply'] }],
  ['instandhaltung', { capabilities: ['maintenance'] }],
  // Eine Fähigkeit „Führung“ gibt es nicht (wie bei den Fachobjekten).
  ['fuehrung', null],
  ['iuk', { capabilities: ['information-communications'] }],
  ['erkundung', { capabilities: ['reconnaissance'] }],
  ['veterinaerwesen', { bodyMarks: ['veterinary'] }],
  ['schlachten', { capabilities: ['slaughter-culling'] }],
  ['wasserrettung', { bodyMarks: ['water-rescue'] }],
  ['wasserfahrzeuge', { bodyMarks: ['watercraft-operations'] }],
  ['rettungshunde', { capabilities: ['biological-location'] }],
  ['pumpen', { bodyMarks: ['pumping'] }],
  ['abwehr-wassergefahren', { capabilities: ['water-hazard-control'] }],
  // Näherung: Lautsprecherwarnung.
  ['warnen', { capabilities: ['loudspeaker-warning'] }],
];
const FACHAUFGABE_NAEHERUNG = new Set([
  'dekontamination-personen',
  'dekontamination-geraete',
  'warnen',
]);

// Grundzeichen, die im Altkatalog eine Fachaufgabe annahmen, und ihr Körper (`kind`).
const FACHAUFGABE_TRAEGER: Array<[string, SymbolSpec['kind']]> = [
  ['taktische-formation', 'formation'],
  ['befehlsstelle', 'formation'],
  ['stelle', 'circle-12'],
  ['ortsfeste-stelle', 'circle-12'],
  ['person', 'person'],
  ['gebaeude', 'building'],
  ['fahrzeug', 'vehicle-land'],
  ['kraftfahrzeug-landgebunden', 'vehicle-land'],
  ['kraftfahrzeug-gelaendegaengig', 'vehicle-land'],
  ['kraftfahrzeug-gelaendegaengig-kategorie3', 'vehicle-land'],
  ['amphibienfahrzeug', 'vehicle-land'],
  ['wechsellader', 'swap-loader-vehicle'],
  ['wechsellader-wechselbehaelter', 'swap-loader-vehicle'],
  ['abrollbehaelter', 'swap-loader-vehicle'],
  ['wechselbehaelter', 'swap-loader-vehicle'],
  ['wechselbruecke', 'swap-loader-vehicle'],
  ['rollcontainer', 'swap-loader-vehicle'],
  ['anhaenger', 'trailer'],
  ['anhaenger-abrollbehaelter', 'trailer'],
  ['anhaenger-wechselbehaelter', 'trailer'],
  ['anhaenger-pkw', 'trailer'],
  ['anhaenger-lkw', 'trailer'],
  ['schienenfahrzeug', 'vehicle-land'],
  ['kettenfahrzeug', 'vehicle-land'],
  ['wasserfahrzeug', 'vehicle-water'],
];

describe('freiesZeichen — Fachaufgaben (D5)', () => {
  it('deckt alle 42 Fachaufgaben ab', () => {
    expect(FACHAUFGABEN).toHaveLength(42);
  });

  it.each(FACHAUFGABEN)('%s an der Formation', (fachaufgabe, teil) => {
    pruefe(
      { grundzeichen: 'taktische-formation', fachaufgabe },
      { kind: 'formation', ...teil } as SymbolSpec,
      teil === null ? 'kaskade' : FACHAUFGABE_NAEHERUNG.has(fachaufgabe) ? 'naeherung' : 'exakt',
    );
  });

  // Alle 42 × 25 Paare: der Körper bleibt stehen, nie der Platzhalter, nie ein Wurf.
  it.each(FACHAUFGABE_TRAEGER)('jede Fachaufgabe am annehmenden Grundzeichen %s', (gz, kind) => {
    for (const [fachaufgabe] of FACHAUFGABEN) {
      const z = freiesZeichen({ grundzeichen: gz, fachaufgabe, organisation: 'feuerwehr' });
      expect(z.spec.kind, `${gz} + ${fachaufgabe}`).toBe(kind);
      expect(() => drawAnySpec(z.spec)).not.toThrow();
    }
  });

  it('ignoriert eine Fachaufgabe an einem Grundzeichen, das keine annahm (Altkatalog)', () => {
    pruefe(
      { grundzeichen: 'gefahr', fachaufgabe: 'brandbekaempfung' },
      { kind: 'hazard' },
      'exakt',
    );
  });

  it('lässt eine unbekannte Fachaufgabe weg und behält Stärke und Organisation', () => {
    pruefe(
      {
        grundzeichen: 'taktische-formation',
        organisation: 'thw',
        einheit: 'gruppe',
        fachaufgabe: 'gibt-es-nicht',
      },
      { kind: 'formation', organization: 'thw', strength: 'gruppe' },
      'kaskade',
    );
  });
});

const EINHEITEN: Array<[string, Teil]> = [
  ['trupp', { strength: 'trupp' }],
  ['staffel', { strength: 'staffel' }],
  ['gruppe', { strength: 'gruppe' }],
  ['zug', { strength: 'zug' }],
  ['zugtrupp', { strength: 'trupp', bodyMarks: ['formation-solid-cap-3mm'] }],
  ['bereitschaft', { unitGrouping: 'verband-i' }],
  ['abteilung', { unitGrouping: 'verband-ii' }],
  ['grossverband', { unitGrouping: 'verband-iii' }],
];

describe('freiesZeichen — Einheiten (D5)', () => {
  it.each(EINHEITEN)('%s an der Formation', (einheit, teil) => {
    pruefe(
      { grundzeichen: 'taktische-formation', einheit },
      { kind: 'formation', ...teil } as SymbolSpec,
      'exakt',
    );
  });

  it('lässt am Kraftfahrzeug eine Stärke weg (strength-requires-unit)', () => {
    pruefe(
      { grundzeichen: 'kraftfahrzeug-landgebunden', einheit: 'zug', organisation: 'thw' },
      { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-1', organization: 'thw' },
      'kaskade',
    );
  });

  it('behält bei Fachaufgabe und Stärke beide, wenn sie zusammen zeichnen', () => {
    pruefe(
      {
        grundzeichen: 'taktische-formation',
        organisation: 'feuerwehr',
        einheit: 'gruppe',
        fachaufgabe: 'brandbekaempfung',
      },
      {
        kind: 'formation',
        organization: 'feuerwehr',
        strength: 'gruppe',
        bodyMarks: ['fire-fighting'],
      },
      'exakt',
    );
  });
});

describe('freiesZeichen — Funktionen entfallen (D5)', () => {
  it.each(['fuehrungskraft', 'sonderfunktion'])('%s an der Person', (funktion) => {
    pruefe(
      { grundzeichen: 'person', organisation: 'feuerwehr', funktion },
      { kind: 'person', organization: 'feuerwehr' },
      'kaskade',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Kaskade (Spec lagekarte-taktische-zeichen, „Definierter Rückfall statt Ausfall“)
// ---------------------------------------------------------------------------------------------

describe('freiesZeichen — Kaskade Symbol → Fachaufgabe → Einheit → Organisation → Farbe → Körper', () => {
  it('lässt zuerst das Symbol fallen und behält die Fachaufgabe', () => {
    pruefe(
      {
        grundzeichen: 'stelle',
        organisation: 'hilfsorganisation',
        fachaufgabe: 'rettungswesen',
        symbol: 'person-verletzt',
      },
      { kind: 'circle-12', organization: 'hilfsorganisation', bodyMarks: ['medical-service'] },
      'kaskade',
    );
  });

  it('lässt an der Formation ein Grundzeichen als Symbol fallen', () => {
    pruefe(
      { grundzeichen: 'taktische-formation', organisation: 'thw', symbol: 'fahrzeug' },
      { kind: 'formation', organization: 'thw' },
      'kaskade',
    );
  });

  it('behält die Stärke, wenn nur die Fachaufgabe nicht zeichnet', () => {
    pruefe(
      {
        grundzeichen: 'taktische-formation',
        organisation: 'feuerwehr',
        einheit: 'zug',
        fachaufgabe: 'fuehrung',
      },
      { kind: 'formation', organization: 'feuerwehr', strength: 'zug' },
      'kaskade',
    );
  });

  it('lässt am Hubschrauber die Stärke fallen und behält die Organisation', () => {
    pruefe(
      { grundzeichen: 'hubschrauber', organisation: 'polizei', einheit: 'trupp' },
      { kind: 'vehicle-air', organization: 'polizei' },
      'kaskade',
    );
  });

  it('gibt für denselben Eingang dasselbe Objekt zurück (Cache)', () => {
    const e: FreiesZeichenEingabe = { grundzeichen: 'person', organisation: 'polizei' };
    expect(freiesZeichen({ ...e })).toBe(freiesZeichen({ ...e }));
  });

  it('trennt den Cache nach jedem Feld', () => {
    expect(freiesZeichen({ grundzeichen: 'gefahr', farbe: '#cc0000' })).not.toBe(
      freiesZeichen({ grundzeichen: 'gefahr', farbe: '#14a01e' }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Farbe (D6)
// ---------------------------------------------------------------------------------------------

describe('freiesZeichen — Farbe aus der Palette (D6)', () => {
  it('bildet #cc0000 an der Gefahr auf rot ab', () => {
    pruefe(
      { grundzeichen: 'gefahr', farbe: '#cc0000' },
      { kind: 'hazard', technicalFill: 'rot' },
      'exakt',
    );
  });

  it('färbt die vermutete Gefahr und die Maßnahme', () => {
    pruefe(
      { grundzeichen: 'gefahr-vermutet', farbe: '#14a01e' },
      { kind: 'hazard', states: ['suspected-situation'], technicalFill: 'gruen' },
      'exakt',
    );
    pruefe(
      { grundzeichen: 'massnahme', farbe: '#fafa00' },
      { kind: 'measure', technicalFill: 'gelb' },
      'exakt',
    );
  });

  it('lässt die Farbe an der Person entfallen (das Altpaket zeichnete sie dort nicht)', () => {
    pruefe(
      { grundzeichen: 'person', organisation: 'thw', farbe: '#cc0000' },
      { kind: 'person', organization: 'thw' },
      'exakt',
    );
  });

  it('lässt die Farbe an einem freistehenden Symbol entfallen', () => {
    pruefe(
      { grundzeichen: 'ohne', symbol: 'vollbrand', farbe: '#cc0000' },
      ZUSTAND('fully-developed-fire'),
      'exakt',
    );
  });

  it('lässt eine unlesbare Farbe entfallen', () => {
    pruefe({ grundzeichen: 'gefahr', farbe: 'rötlich' }, { kind: 'hazard' }, 'kaskade');
  });

  it('ergibt für dieselbe Farbe immer dasselbe Token', () => {
    const a = freiesZeichen({ grundzeichen: 'gefahr', farbe: '#d7821e' }).spec;
    const b = freiesZeichen({ grundzeichen: 'massnahme', farbe: '#D7821E' }).spec;
    expect((a as SymbolSpec).technicalFill).toBe((b as SymbolSpec).technicalFill);
    expect(naechstesFarbtoken('#d7821e')).toBe(naechstesFarbtoken('#D7821E'));
  });

  it.each<[string, TechnicalFillToken]>([
    ['#cc0000', 'rot'],
    ['#000000', 'schwarz'],
    ['#ffffff', 'weiss'],
    ['#333333', 'schwarz'],
    ['#f5222d', 'rot'],
    ['#faad14', 'orange'],
    ['#1677ff', 'hellblau'],
    ['#fff', 'weiss'],
  ])('%s → %s', (hex, token) => {
    expect(naechstesFarbtoken(hex)).toBe(token);
  });

  it('entscheidet einen Gleichstand nach der Reihenfolge der Tokenliste', () => {
    // #fac300 liegt genau zwischen gelb (#fafa00) und orange (#fa8c00): je 55² Abstand.
    expect(naechstesFarbtoken('#fac300')).toBe('gelb');
    // #96785a liegt genau zwischen braun und grau; braun steht vorn.
    expect(naechstesFarbtoken('#96785a')).toBe('braun');
  });

  it('liefert für Unlesbares kein Token', () => {
    expect(naechstesFarbtoken('rot')).toBeNull();
    expect(naechstesFarbtoken('#12345')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// zeichen_spec (D1, D5 Schritt 1)
// ---------------------------------------------------------------------------------------------

describe('freiesZeichen — gespeicherte Spec (zeichen_spec)', () => {
  it('zeichnet einen gültigen String genau als diese Spec', () => {
    const spec: SymbolSpec = {
      kind: 'circle-12',
      organization: 'hilfsorganisation',
      bodyMarks: ['medical-service'],
    };
    pruefe({ zeichen_spec: serializeAnySpec(spec) }, spec, 'exakt');
  });

  it('zeichnet eine freistehende Spec', () => {
    const spec = { kind: 'pictogram', pictogram: 'capability.rescue-aerial-ladder' } as AnySpec;
    pruefe({ zeichen_spec: serializeAnySpec(spec) }, spec, 'exakt');
  });

  it('geht der Altspalte vor', () => {
    pruefe(
      { zeichen_spec: serializeAnySpec({ kind: 'hazard' }), grundzeichen: 'person' },
      { kind: 'hazard' },
      'exakt',
    );
  });

  it('gleiche Spec wie ein Fachobjekt ergibt denselben Schlüssel', () => {
    expect(freiesZeichen({ zeichen_spec: '{"v":1,"spec":{"kind":"event"}}' }).schluessel).toBe(
      'ez|{"v":1,"spec":{"kind":"event"}}',
    );
  });

  it('fällt bei einem kaputten String auf die Altfelder zurück', () => {
    pruefe(
      { zeichen_spec: '{kaputt', grundzeichen: 'gefahr', farbe: '#cc0000' },
      { kind: 'hazard', technicalFill: 'rot' },
      'kaskade',
    );
  });

  it('fällt bei einem kaputten String ohne Altfelder auf den Platzhalter', () => {
    pruefe({ zeichen_spec: '{"v":1,"spec":{"kind":"quatsch"}}' }, PUNKT, 'platzhalter');
  });

  it('läuft bei einer abgelehnten Spec die Kaskade über ihre Felder', () => {
    // Zwei Hinweise an der Gefahr lehnt 5.x ab (state-hint-limit-exceeded): das Symbol entfällt,
    // Organisation und Füllung bleiben.
    pruefe(
      {
        zeichen_spec: serializeAnySpec({
          kind: 'hazard',
          states: ['suspected-situation', 'acute-situation'],
          technicalFill: 'rot',
        }),
      },
      { kind: 'hazard', technicalFill: 'rot' },
      'kaskade',
    );
  });

  it('hält bei einer abgelehnten Stärke die Reihenfolge der Kaskade ein', () => {
    // Fachaufgabe vor Einheitsgröße: die Fachaufgabe (`bodyMarks`) entfällt zuerst, dann die
    // Stärke; Kategorie und Organisation bleiben.
    pruefe(
      {
        zeichen_spec: serializeAnySpec({
          kind: 'vehicle-land',
          vehicleCategory: 'kfz-kategorie-1',
          organization: 'thw',
          bodyMarks: ['transport'],
          strength: 'zug',
        }),
      },
      { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-1', organization: 'thw' },
      'kaskade',
    );
  });

  it('lässt bei einer abgelehnten Stärke ohne Fachaufgabe nur die Stärke fallen', () => {
    pruefe(
      {
        zeichen_spec: serializeAnySpec({
          kind: 'vehicle-land',
          vehicleCategory: 'kfz-kategorie-1',
          organization: 'thw',
          strength: 'zug',
        }),
      },
      { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-1', organization: 'thw' },
      'kaskade',
    );
  });

  it('lässt bei einer abgelehnten Organisation die Organisation vor der Füllung fallen', () => {
    // Füllung und Organisation schließen einander aus (technical-fill-organization-conflict).
    pruefe(
      {
        zeichen_spec: serializeAnySpec({
          kind: 'hazard',
          organization: 'feuerwehr',
          technicalFill: 'rot',
        }),
      },
      { kind: 'hazard', technicalFill: 'rot' },
      'kaskade',
    );
  });

  it('schreibt eine nicht kanonische freistehende Spec auf ihre kanonische um', () => {
    pruefe(
      { zeichen_spec: '{"v":1,"freestanding":{"kind":"state","state":"person-injured"}}' },
      { kind: 'person', states: ['person-injured'] },
      'exakt',
    );
  });

  it('nimmt null und leeren String wie fehlend', () => {
    pruefe({ zeichen_spec: null, grundzeichen: 'gefahr' }, { kind: 'hazard' }, 'exakt');
    pruefe({ zeichen_spec: '', grundzeichen: 'gefahr' }, { kind: 'hazard' }, 'exakt');
  });
});
