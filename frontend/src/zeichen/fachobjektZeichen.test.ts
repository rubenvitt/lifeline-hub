import { renderSvg } from '@einsatzzeichen/core';
import type { SymbolSpec } from '@einsatzzeichen/schema';
import { describe, expect, it } from 'vitest';
import {
  baueTzProps,
  betreuungsstelleTz,
  einsatzortTz,
  schadenTz,
  uhsTz,
  AUSMASS_FARBE,
  type TzProps,
} from '../pages/lagekarte/taktischesZeichen';
import type { Ausmass, UhsTyp } from '../api/types';
import {
  bereitstellungsraumZeichen,
  tierZeichen,
  fachobjektZeichen,
  funktionsZeichen,
} from './fachobjektZeichen';

// Pins der fachlichen Abbildung Hub-Vokabular → @einsatzzeichen (LFH-835, design.md D2). Jeder Fall
// zeichnet echt über `drawSymbol`: ein Bibliotheks-Update, das eine Abbildung bricht, wird hier rot
// statt im Betrieb still zum Rückfall.
function wirksam(tz: TzProps): SymbolSpec {
  const z = fachobjektZeichen(tz);
  expect(z, `kein Zeichen für ${JSON.stringify(tz)}`).not.toBeNull();
  return z!.spec;
}

const FAELLE: Array<[string, TzProps, SymbolSpec]> = [
  [
    'Einheit Gruppe Feuerwehr mit Brandbekämpfung',
    baueTzProps({
      objekttyp: 'einheit',
      einheitTypLabel: 'Gruppe',
      organisation: 'feuerwehr',
      fachaufgabe: 'brandbekaempfung',
    }),
    {
      kind: 'formation',
      organization: 'feuerwehr',
      strength: 'gruppe',
      bodyMarks: ['fire-fighting'],
    },
  ],
  ...(['Trupp', 'Staffel', 'Zug'] as const).map((label): [string, TzProps, SymbolSpec] => [
    `Einheit ${label}`,
    baueTzProps({ objekttyp: 'einheit', einheitTypLabel: label, organisation: 'thw' }),
    {
      kind: 'formation',
      organization: 'thw',
      strength: label.toLowerCase() as 'trupp' | 'staffel' | 'zug',
    },
  ]),
  [
    'Einheit Zugtrupp = Trupp mit Formationskappe',
    baueTzProps({ objekttyp: 'einheit', einheitTypLabel: 'Zugtrupp', organisation: 'feuerwehr' }),
    {
      kind: 'formation',
      organization: 'feuerwehr',
      strength: 'trupp',
      bodyMarks: ['formation-solid-cap-3mm'],
    },
  ],
  [
    // Seit @einsatzzeichen 3.0.0 randbündig (vermessene Körperfassung C.1.4). Seit 4.0 zeichnet
    // auch die Box dort dieselbe Fassung; randbündig steht in der Stufe zuerst.
    'Einheit THW mit Technischer Hilfe (randbündig, C.1.4)',
    baueTzProps({
      objekttyp: 'einheit',
      einheitTypLabel: 'Gruppe',
      organisation: 'thw',
      fachaufgabe: 'technische-hilfeleistung',
    }),
    {
      kind: 'formation',
      organization: 'thw',
      strength: 'gruppe',
      bodyMarks: ['technical-assistance'],
    },
  ],
  [
    'Fahrzeug LF der Feuerwehr',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'HLF 20', traegerorganisation: 'FF Nord' }),
    {
      kind: 'vehicle-land',
      vehicleCategory: 'kfz-kategorie-1',
      organization: 'feuerwehr',
      bodyMarks: ['fire-fighting'],
    },
  ],
  [
    'Fahrzeug RTW der Hilfsorganisation (Radpaar statt Kategorie, F.2)',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'RTW', traegerorganisation: 'DRK' }),
    {
      kind: 'vehicle-land',
      bodyVariant: 'plain-wheel-pair',
      organization: 'hilfsorganisation',
      bodyMarks: ['medical-service'],
    },
  ],
  [
    'Fahrzeug RW mit Technischer Hilfe',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'RW', traegerorganisation: 'Feuerwehr' }),
    {
      kind: 'vehicle-land',
      vehicleCategory: 'kfz-kategorie-1',
      organization: 'feuerwehr',
      bodyMarks: ['technical-assistance'],
    },
  ],
  [
    'Fahrzeug GW-L mit Logistik als Fußband',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'GW-L', traegerorganisation: 'Feuerwehr' }),
    {
      kind: 'vehicle-land',
      vehicleCategory: 'kfz-kategorie-1',
      bodyVariant: 'foot-band',
      organization: 'feuerwehr',
    },
  ],
  [
    'Fahrzeug ELW: Fachaufgabe Führung entfällt, Organisationsfarbe bleibt',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'ELW 1', traegerorganisation: 'Feuerwehr' }),
    { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-1', organization: 'feuerwehr' },
  ],
  [
    'Boot',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'MZB', traegerorganisation: 'DLRG' }),
    { kind: 'vehicle-water', organization: 'hilfsorganisation' },
  ],
  [
    'Hubschrauber',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'Hubschrauber', opta: 'Polizei' }),
    { kind: 'vehicle-air', organization: 'polizei' },
  ],
  [
    'Anhänger',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'Anhänger', traegerorganisation: 'THW' }),
    { kind: 'trailer', organization: 'thw' },
  ],
  [
    'Krad wird Landfahrzeug',
    baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'Krad', traegerorganisation: 'Polizei' }),
    { kind: 'vehicle-land', organization: 'polizei' },
  ],
  [
    'Führungskraft ohne Funktion',
    baueTzProps({ objekttyp: 'fuehrung', organisation: 'feuerwehr' }),
    { kind: 'person', organization: 'feuerwehr' },
  ],
  // Die Fachaufgabe der Person kommt aus ihrer Funktion und ist an der Person nur abgeleitet
  // gezeichnet (LLH-1161). Einheitsführer und Abschnittsleiter tragen dazu den
  // Führungskraft-Indikator, die Marke sitzt dann an der Hülle der Funktionsfassung (LLH-1231).
  ...(
    [
      ['Notarzt', 'physician'],
      ['Rettungssanitäter', 'medical-service'],
      ['Funk', 'information-communications'],
    ] as const
  ).flatMap(([funktion, marke]): Array<[string, TzProps, SymbolSpec]> => [
    [
      `Führungskraft ${funktion}: Person mit Fachaufgabe und Funktionsindikator`,
      baueTzProps({
        objekttyp: 'fuehrung',
        organisation: 'hilfsorganisation',
        funktion,
        istFuehrungskraft: true,
      }),
      {
        kind: 'person',
        organization: 'hilfsorganisation',
        bodyMarks: [marke],
        functionRole: 'leader',
      },
    ],
    [
      `Person ${funktion} ohne Führung: Person mit Fachaufgabe, ohne Funktionsindikator`,
      baueTzProps({
        objekttyp: 'fuehrung',
        organisation: 'hilfsorganisation',
        funktion,
        istFuehrungskraft: false,
      }),
      { kind: 'person', organization: 'hilfsorganisation', bodyMarks: [marke] },
    ],
  ]),
  [
    'Führungskraft ohne Funktion: Person mit Funktionsindikator',
    baueTzProps({ objekttyp: 'fuehrung', organisation: 'thw', istFuehrungskraft: true }),
    { kind: 'person', organization: 'thw', functionRole: 'leader' },
  ],
  [
    'Führungskraft ohne Organisation: Person mit Funktionsindikator',
    baueTzProps({ objekttyp: 'fuehrung', istFuehrungskraft: true }),
    { kind: 'person', functionRole: 'leader' },
  ],
  [
    'Einsatzabschnitt neutral: Führung und Leitung ohne Kürzel',
    baueTzProps({ objekttyp: 'abschnitt', organisation: 'feuerwehr' }),
    { kind: 'formation', organization: 'fuehrung-leitung' },
  ],
  ['Einsatzort', einsatzortTz(), { kind: 'event' }],
  ...(
    [
      ['gering', 'gruen'],
      ['mittel', 'gelb'],
      ['gross', 'orange'],
      ['katastrophal', 'rot'],
      ['unbekannt', 'grau'],
    ] as const
  ).map(([ausmass, token]): [string, TzProps, SymbolSpec] => [
    `Schaden ${ausmass}`,
    schadenTz(ausmass as Ausmass),
    { kind: 'hazard', technicalFill: token },
  ]),
  // Stellen ohne bekannte Organisation des Betreibers stehen neutral (LLH-1161).
  [
    'UHS Behandlungsplatz',
    uhsTz('behandlungsplatz'),
    { kind: 'circle-12', bodyMarks: ['physician'] },
  ],
  ...(['patientenablage', 'verletztensammelstelle', 'sonstige'] as UhsTyp[]).map(
    (typ): [string, TzProps, SymbolSpec] => [
      `UHS ${typ}`,
      uhsTz(typ),
      { kind: 'circle-12', bodyMarks: ['medical-service'] },
    ],
  ),
  ['Betreuungsstelle', betreuungsstelleTz(), { kind: 'circle-12', bodyMarks: ['care'] }],
  [
    'UHS in der Organisation des Betreibers (Feuerwehr)',
    uhsTz('sonstige', 'feuerwehr'),
    { kind: 'circle-12', organization: 'feuerwehr', bodyMarks: ['medical-service'] },
  ],
  [
    'Betreuungsstelle in der Organisation des Betreibers (Hilfsorganisation)',
    betreuungsstelleTz('hilfsorganisation'),
    { kind: 'circle-12', organization: 'hilfsorganisation', bodyMarks: ['care'] },
  ],
  [
    'Stelle mit alter Organisationskennung des Betreibers',
    betreuungsstelleTz('zivil'),
    { kind: 'circle-12', organization: 'zivile-einheiten', bodyMarks: ['care'] },
  ],
  ...(
    [
      ['fuehrung', 'fuehrung-leitung'],
      ['gefahrenabwehr', 'sonstige-gefahrenabwehr'],
      ['zivil', 'zivile-einheiten'],
    ] as const
  ).map(([alt, neu]): [string, TzProps, SymbolSpec] => [
    `alte Organisationskennung ${alt}`,
    baueTzProps({ objekttyp: 'einheit', organisation: alt }),
    { kind: 'formation', organization: neu },
  ]),
];

describe('fachobjektZeichen — fachliche Abbildung (design.md D2)', () => {
  it.each(FAELLE)('%s', (_name, tz, erwartet) => {
    expect(wirksam(tz)).toEqual(erwartet);
  });

  it.each(FAELLE)('%s zeichnet keinen Text (keine Schrift nötig)', (_name, tz) => {
    const z = fachobjektZeichen(tz)!;
    expect(renderSvg(z.drawing, { size: 34 })).not.toMatch(/<text/);
  });

  it('bildet den Schlüssel aus der wirksamen Spec mit Präfix ez|', () => {
    const z = fachobjektZeichen(einsatzortTz())!;
    expect(z.schluessel).toBe('ez|{"v":1,"spec":{"kind":"event"}}');
  });
});

describe('fachobjektZeichen — Rückfall statt Ausfall (design.md D3)', () => {
  it('lässt eine unbekannte Fachaufgabe weg und behält Stärke und Organisation', () => {
    expect(
      wirksam({
        grundzeichen: 'taktische-formation',
        organisation: 'thw',
        einheit: 'gruppe',
        fachaufgabe: 'gibt-es-nicht' as TzProps['fachaufgabe'],
      }),
    ).toEqual({ kind: 'formation', organization: 'thw', strength: 'gruppe' });
  });

  it('lässt eine unbekannte Organisation weg und behält die Stärke', () => {
    expect(
      wirksam({
        grundzeichen: 'taktische-formation',
        organisation: 'quatsch' as TzProps['organisation'],
        einheit: 'zug',
      }),
    ).toEqual({ kind: 'formation', strength: 'zug' });
  });

  it('zeichnet eine am Kfz nicht vermessene Fachaufgabe abgeleitet statt sie wegzulassen', () => {
    // IuK ist am Kraftfahrzeug weder randbündig noch als Box vermessen; seit core 4.0 leitet der
    // Motor die Marke ab („Ableiten statt Messsperre“, LFH-991).
    const tz: TzProps = {
      grundzeichen: 'kraftfahrzeug-landgebunden',
      organisation: 'hilfsorganisation',
      fachaufgabe: 'iuk',
    };
    expect(wirksam(tz)).toEqual({
      kind: 'vehicle-land',
      vehicleCategory: 'kfz-kategorie-1',
      organization: 'hilfsorganisation',
      bodyMarks: ['information-communications'],
    });
    expect(fachobjektZeichen(tz)!.drawing.derivations).not.toHaveLength(0);
  });

  it('zeichnet den Führungskraft-Indikator an der Person stets abgeleitet', () => {
    // `leader` hat kein eigenes Original (ESZ-116): Raute und Kappe des Einsatzleiters ohne Lauf.
    const z = fachobjektZeichen(
      baueTzProps({ objekttyp: 'fuehrung', organisation: 'feuerwehr', istFuehrungskraft: true }),
    )!;
    expect(z.spec).toEqual({ kind: 'person', organization: 'feuerwehr', functionRole: 'leader' });
    expect(z.drawing.derivations).not.toHaveLength(0);
    expect(z.schluessel).not.toBe(
      fachobjektZeichen(baueTzProps({ objekttyp: 'fuehrung', organisation: 'feuerwehr' }))!
        .schluessel,
    );
  });

  it('lässt den Funktionsindikator weg, wo der Körper ihn nicht trägt', () => {
    // Die Führungskraft ist eine Person; an der Formation komponiert `leader` nicht.
    expect(
      wirksam({
        grundzeichen: 'taktische-formation',
        organisation: 'feuerwehr',
        einheit: 'gruppe',
        fachaufgabe: 'brandbekaempfung',
        funktion: 'fuehrungskraft',
      }),
    ).toEqual({
      kind: 'formation',
      organization: 'feuerwehr',
      strength: 'gruppe',
      bodyMarks: ['fire-fighting'],
    });
  });

  it('ignoriert eine unbekannte Funktion', () => {
    expect(
      wirksam({
        grundzeichen: 'person',
        organisation: 'feuerwehr',
        funktion: 'gibt-es-nicht' as TzProps['funktion'],
      }),
    ).toEqual({ kind: 'person', organization: 'feuerwehr' });
  });

  it('lässt eine am Körper unzulässige Stärke weg und behält die Organisation', () => {
    // Stärke gibt es nur an Formation und Person (strength-requires-unit).
    expect(
      wirksam({
        grundzeichen: 'wasserfahrzeug',
        organisation: 'hilfsorganisation',
        einheit: 'gruppe',
      }),
    ).toEqual({ kind: 'vehicle-water', organization: 'hilfsorganisation' });
  });

  it('lässt eine unverträgliche Organisation weg und behält die Füllung', () => {
    // Füllung und Organisation schließen einander aus (technical-fill-organization-conflict).
    expect(
      wirksam({ grundzeichen: 'gefahr', organisation: 'feuerwehr', farbe: '#f5222d' }),
    ).toEqual({ kind: 'hazard', technicalFill: 'rot' });
  });

  it('zeichnet ärztliche Versorgung am Kfz auf dem Radpaar (NEF, F.2.4)', () => {
    // Seit core 4.0 ginge die Arztmarke auch abgeleitet auf der Kfz-Kategorie; die vermessene
    // Radpaar-Fassung derselben Stufe geht vor.
    const tz: TzProps = {
      grundzeichen: 'kraftfahrzeug-landgebunden',
      organisation: 'hilfsorganisation',
      fachaufgabe: 'aerztliche-versorgung',
    };
    expect(fachobjektZeichen(tz)!.drawing.derivations ?? []).toHaveLength(0);
    expect(wirksam(tz)).toEqual({
      kind: 'vehicle-land',
      bodyVariant: 'plain-wheel-pair',
      organization: 'hilfsorganisation',
      bodyMarks: ['physician'],
    });
  });

  it('zeichnet die Versorgungsmarke am Fußband des Kfz abgeleitet, statt sie aufzugeben', () => {
    // Bis core 3.0 blieb hier nur das Fußband; die Stufe „Fußband allein“ greift jetzt erst, wenn
    // auch die abgeleitete Marke nicht komponiert.
    expect(
      wirksam({
        grundzeichen: 'kraftfahrzeug-landgebunden',
        organisation: 'feuerwehr',
        fachaufgabe: 'verpflegung',
      }),
    ).toEqual({
      kind: 'vehicle-land',
      vehicleCategory: 'kfz-kategorie-1',
      bodyVariant: 'foot-band',
      organization: 'feuerwehr',
      bodyMarks: ['catering'],
    });
  });

  it('bildet die Fachaufgabe Transport ab', () => {
    expect(
      wirksam({
        grundzeichen: 'kraftfahrzeug-landgebunden',
        organisation: 'thw',
        fachaufgabe: 'transport',
      }),
    ).toMatchObject({ bodyMarks: ['transport'] });
  });

  it('zeichnet die Füllung am Ereignis abgeleitet, statt auf den Körper allein zu fallen', () => {
    // Bis core 3.0 nahm das Ereignis keine Füllung; seit 4.0 konstruiert der Motor sie.
    const tz: TzProps = { grundzeichen: 'anlass', farbe: AUSMASS_FARBE.katastrophal };
    expect(wirksam(tz)).toEqual({ kind: 'event', technicalFill: 'rot' });
    expect(fachobjektZeichen(tz)!.drawing.derivations).not.toHaveLength(0);
  });

  it('liefert für ein unbekanntes Grundzeichen null statt zu werfen', () => {
    expect(
      fachobjektZeichen({ grundzeichen: 'gibt-es-nicht' as TzProps['grundzeichen'] }),
    ).toBeNull();
  });

  it('gibt für denselben Eingang dasselbe Objekt zurück (Cache)', () => {
    const tz: TzProps = { grundzeichen: 'person', organisation: 'polizei' };
    expect(fachobjektZeichen({ ...tz })).toBe(fachobjektZeichen({ ...tz }));
  });
});

// Schaden mit Gefahrenart und Schadensgrad (LLH-1115, design.md D2/D3): der Gefahrenhinweis 5.8.1
// und der Schadensgrad 5.8.4 hängen als `states` am Träger „Gefahr“, das Ausmaß bleibt die Füllung.
describe('fachobjektZeichen — Schaden mit Gefahrenart und Schadensgrad (LLH-1115)', () => {
  it('zeichnet Elektrizität bei Ausmaß „groß“ als orangen Träger mit Hinweis „elektrische Energie“', () => {
    expect(wirksam(schadenTz('gross', 'elektrizitaet'))).toEqual({
      kind: 'hazard',
      technicalFill: 'orange',
      states: ['electrical-energy-hazard'],
    });
  });

  it.each([
    ['atomare_strahlung', 'radioactivity-hazard'],
    ['chemische_stoffe', 'hazardous-substances'],
    ['explosion', 'explosion-hazard'],
    ['elektrizitaet', 'electrical-energy-hazard'],
    ['ertrinken', 'water-ingress-hazard'],
  ] as const)('bildet die Gefahr %s auf den Hinweis %s ab', (gefahr, zustand) => {
    expect(wirksam(schadenTz('mittel', gefahr)).states).toEqual([zustand]);
  });

  it.each([
    'atemgifte',
    'angstreaktion',
    'ausbreitung',
    'erkrankung_verletzung',
    'einsturz',
    'absturz',
    'brand',
    'durchbruch',
  ] as const)('lässt die Gefahr %s ohne Hinweis im Katalog beim leeren Dreieck', (gefahr) => {
    expect(wirksam(schadenTz('gering', gefahr))).toEqual({
      kind: 'hazard',
      technicalFill: 'gruen',
    });
  });

  it.each([
    ['angeschlagen', 'damaged'],
    ['teilzerstoert', 'partially-destroyed'],
    ['zerstoert', 'destroyed'],
  ] as const)('zeichnet den Schadensgrad %s als %s (5.8.4)', (grad, zustand) => {
    expect(wirksam(schadenTz('katastrophal', undefined, grad))).toEqual({
      kind: 'hazard',
      technicalFill: 'rot',
      states: [zustand],
    });
  });

  it('trägt Gefahrenhinweis und Schadensgrad zugleich', () => {
    expect(wirksam(schadenTz('gross', 'explosion', 'zerstoert')).states).toEqual([
      'explosion-hazard',
      'destroyed',
    ]);
  });

  it('ohne Gefahrenart und Schadensgrad bleibt das Zeichen wie bisher', () => {
    expect(wirksam(schadenTz('gross', null, null))).toEqual({
      kind: 'hazard',
      technicalFill: 'orange',
    });
  });

  it('liest einen unbekannten gespeicherten Wert wie keinen (Snapshot, Offline-Stand)', () => {
    const tz = schadenTz('mittel', 'lawine' as never, '__proto__' as never);
    expect(wirksam(tz)).toEqual({ kind: 'hazard', technicalFill: 'gelb' });
  });

  it('unterscheidet Gefahrenarten im Bildschlüssel', () => {
    const a = fachobjektZeichen(schadenTz('gross', 'explosion'))!;
    const b = fachobjektZeichen(schadenTz('gross', 'elektrizitaet'))!;
    expect(a.schluessel).not.toBe(b.schluessel);
  });
});

// Personen- und Gerätedekontamination: „P“ bzw. „G“ als mittiger Lauf zwischen den Klammern der
// Zange (C.1.8, C.1.10, C.2.25; einsatzzeichen ESZ-132, LLH-1338).
describe('fachobjektZeichen — Dekontamination Personen/Geräte', () => {
  const TRAEGER: TzProps[] = [
    { grundzeichen: 'taktische-formation', organisation: 'feuerwehr', einheit: 'staffel' },
    { grundzeichen: 'kraftfahrzeug-landgebunden', organisation: 'feuerwehr' },
    { grundzeichen: 'stelle' },
    { grundzeichen: 'person', organisation: 'hilfsorganisation' },
  ];

  it.each(TRAEGER)('trägt P und G an der Marke ($grundzeichen)', (basis) => {
    for (const [fachaufgabe, zusatz] of [
      ['dekontamination-personen', 'P'],
      ['dekontamination-geraete', 'G'],
    ] as const) {
      const z = fachobjektZeichen({ ...basis, fachaufgabe } as TzProps)!;
      expect(z.spec).toMatchObject({
        bodyMarks: ['decontamination'],
        labels: { center: zusatz },
      });
      expect(renderSvg(z.drawing)).toContain(`>${zusatz}<`);
    }
  });

  it('zeichnet die Staffel (C.1.8) und das Kfz (C.2.25) vermessen', () => {
    for (const basis of TRAEGER.slice(0, 2)) {
      const z = fachobjektZeichen({
        ...basis,
        fachaufgabe: 'dekontamination-personen',
      } as TzProps)!;
      expect(z.drawing.derivations ?? []).toEqual([]);
    }
  });

  it('unterscheidet Dekontamination, Personen und Geräte im Bildschlüssel', () => {
    const schluessel = [
      'dekontamination',
      'dekontamination-personen',
      'dekontamination-geraete',
    ].map(
      (fachaufgabe) => fachobjektZeichen({ ...TRAEGER[0], fachaufgabe } as TzProps)!.schluessel,
    );
    expect(new Set(schluessel).size).toBe(3);
  });

  it('lässt die Dekontamination ohne Zusatz ohne Lauf', () => {
    expect(
      wirksam({ ...TRAEGER[0], fachaufgabe: 'dekontamination' } as TzProps).labels,
    ).toBeUndefined();
  });
});

// Drift-Wache: welche Fachaufgaben des Hub-Vokabulars die Bibliothek am Körper NICHT zeichnet
// (Rückfall ohne Fachaufgabe) und welche sie nur ABGELEITET zeichnet. Ändert ein Update von
// @einsatzzeichen die Komponierbarkeit oder die Vermessung, wird das hier in BEIDE Richtungen rot —
// ein stiller Verlust genauso wie ein neu vermessenes Paar, das dann in design.md D2 und die
// Abbildungspins gehört (Stand core 4.1.0, 05.10.2026).
describe('fachobjektZeichen — Abdeckung der Fachaufgaben je Körper', () => {
  const ALLE_FACHAUFGABEN = [
    'brandbekaempfung',
    'hoehenrettung',
    'wasserversorgung',
    'technische-hilfeleistung',
    'heben',
    'bergung',
    'raeumen',
    'entschaerfen',
    'sprengen',
    'beleuchtung',
    'transport',
    'abc',
    'messen',
    'dekontamination',
    'dekontamination-personen',
    'dekontamination-geraete',
    'umweltschaeden-gewaesser',
    'rettungswesen',
    'aerztliche-versorgung',
    'krankenhaus',
    'einsatzeinheit',
    'betreuung',
    'seelsorge',
    'unterbringung',
    'logistik',
    'verpflegung',
    'verbrauchsgueter',
    'versorgung-trinkwasser',
    'versorgung-brauchwasser',
    'versorgung-elektrizitaet',
    'instandhaltung',
    'fuehrung',
    'iuk',
    'erkundung',
    'veterinaerwesen',
    'schlachten',
    'wasserrettung',
    'wasserfahrzeuge',
    'rettungshunde',
    'pumpen',
    'abwehr-wassergefahren',
    'warnen',
  ];
  const ohneFachaufgabe = (basis: TzProps) =>
    ALLE_FACHAUFGABEN.filter((fachaufgabe) => {
      const s = wirksam({ ...basis, fachaufgabe } as TzProps);
      const marken = (s.bodyMarks ?? []).filter((m) => !m.startsWith('formation-'));
      return !s.capabilities && marken.length === 0 && s.bodyVariant === undefined;
    });
  const abgeleitet = (basis: TzProps) =>
    ALLE_FACHAUFGABEN.filter(
      (fachaufgabe) =>
        (fachobjektZeichen({ ...basis, fachaufgabe } as TzProps)!.drawing.derivations ?? [])
          .length > 0,
    );
  const FORMATION: TzProps = {
    grundzeichen: 'taktische-formation',
    organisation: 'feuerwehr',
    einheit: 'gruppe',
  };
  const KFZ: TzProps = { grundzeichen: 'kraftfahrzeug-landgebunden', organisation: 'feuerwehr' };
  const PERSON: TzProps = { grundzeichen: 'person', organisation: 'hilfsorganisation' };
  const STELLE: TzProps = { grundzeichen: 'stelle' };

  // `fuehrung` fehlt in FAEHIGKEIT mit Absicht (s. dort); sonst zeichnet core 4.x jede Fachaufgabe.
  it('an der Formation (Feuerwehr, Gruppe)', () => {
    expect(ohneFachaufgabe(FORMATION)).toEqual(['fuehrung']);
  });

  it('am Kraftfahrzeug (Feuerwehr)', () => {
    expect(ohneFachaufgabe(KFZ)).toEqual(['fuehrung']);
  });

  it('an der Person (Führungskraft, Hilfsorganisation)', () => {
    expect(ohneFachaufgabe(PERSON)).toEqual(['fuehrung']);
  });

  it('an der Stelle ohne Organisation', () => {
    expect(ohneFachaufgabe(STELLE)).toEqual(['fuehrung']);
  });

  // An der Person ist keine Fachaufgabe vermessen (LLH-1161): jede erscheint abgeleitet.
  it('abgeleitet an der Person (Führungskraft, Hilfsorganisation)', () => {
    expect(abgeleitet(PERSON)).toEqual(ALLE_FACHAUFGABEN.filter((f) => f !== 'fuehrung'));
  });

  // Mit Funktionsindikator (LLH-1231): jede Fachaufgabe komponiert weiter, und keine verdrängt
  // den Indikator.
  it('an der Person mit Führungskraft-Indikator (Hilfsorganisation)', () => {
    const FUEHRUNGSKRAFT: TzProps = { ...PERSON, funktion: 'fuehrungskraft' };
    expect(ohneFachaufgabe(FUEHRUNGSKRAFT)).toEqual(['fuehrung']);
    const ohneIndikator = ALLE_FACHAUFGABEN.filter(
      (fachaufgabe) =>
        wirksam({ ...FUEHRUNGSKRAFT, fachaufgabe } as TzProps).functionRole !== 'leader',
    );
    expect(ohneIndikator).toEqual([]);
  });

  // Was UHS und Betreuungsstelle tragen, ist an der Stelle ohne Organisation vermessen.
  it('Fachaufgaben der UHS und Betreuungsstelle an der neutralen Stelle vermessen', () => {
    for (const f of ['aerztliche-versorgung', 'rettungswesen', 'betreuung']) {
      expect(abgeleitet(STELLE)).not.toContain(f);
    }
  });

  // Genau die Paare, die bis core 3.0 fehlten (und am Kfz die Versorgungsmarken am Fußband): das
  // Vermessene bleibt vermessen, nur die Lücken sind abgeleitet.
  it('abgeleitet an der Formation (Feuerwehr, Gruppe)', () => {
    expect(abgeleitet(FORMATION)).toEqual([
      'hoehenrettung',
      'heben',
      'entschaerfen',
      'sprengen',
      'beleuchtung',
      'transport',
      'umweltschaeden-gewaesser',
      'krankenhaus',
      'seelsorge',
      'pumpen',
    ]);
  });

  it('abgeleitet am Kraftfahrzeug (Feuerwehr)', () => {
    expect(abgeleitet(KFZ)).toEqual([
      'bergung',
      'raeumen',
      'entschaerfen',
      'sprengen',
      'beleuchtung',
      'umweltschaeden-gewaesser',
      'krankenhaus',
      'einsatzeinheit',
      'seelsorge',
      'unterbringung',
      'verpflegung',
      'verbrauchsgueter',
      'versorgung-trinkwasser',
      'versorgung-brauchwasser',
      'versorgung-elektrizitaet',
      'instandhaltung',
      'iuk',
      'erkundung',
      'veterinaerwesen',
      'schlachten',
      'wasserfahrzeuge',
      'rettungshunde',
      'pumpen',
      'abwehr-wassergefahren',
      'warnen',
    ]);
  });
});

describe('funktionsZeichen — Funktionen im Kasten der Fernmeldeskizze (LFH-1029)', () => {
  const svg = (z: ReturnType<typeof funktionsZeichen>) => {
    expect(z).not.toBeNull();
    return renderSvg(z!.drawing);
  };

  it('zeichnet EAL und UEAL aus den vermessenen Funktionsfassungen', () => {
    const eal = funktionsZeichen({ rolle: 'incident-section-commander' });
    expect(eal!.spec).toMatchObject({ kind: 'person', functionRole: 'incident-section-commander' });
    expect(eal!.drawing.derivations ?? []).toEqual([]);
    expect(svg(eal)).toContain('>EAL<');
    expect(svg(funktionsZeichen({ rolle: 'incident-subsection-commander' }))).toContain('>UEAL<');
  });

  it('zeichnet ein Sachgebiet als Person der Führung mit Kürzel', () => {
    const s2 = funktionsZeichen({ kuerzel: 'S2' });
    expect(s2!.spec).toMatchObject({ kind: 'person', organization: 'fuehrung-leitung' });
    expect(svg(s2)).toContain('>S2<');
  });
});

describe('bereitstellungsraumZeichen — Raumzeichen nach DV 102 (LLH-1107)', () => {
  it('zeichnet das Führungszeichen D.2.1 „Bereitstellungsraum“ aus dem Katalog, vermessen', () => {
    const z = bereitstellungsraumZeichen();
    expect(z).not.toBeNull();
    expect(z!.spec).toEqual({ kind: 'pictogram', pictogram: 'leadership.staging-area' });
    // Wörtlich aus der Kapiteldatei, keine Ableitung des Motors.
    expect(z!.drawing.derivations ?? []).toEqual([]);
    expect(z!.schluessel.startsWith('ez|')).toBe(true);
  });

  it('ist für jeden Raum dasselbe Bild (ein Bildschlüssel, gecacht)', () => {
    expect(bereitstellungsraumZeichen()).toBe(bereitstellungsraumZeichen());
  });
});

describe('tierZeichen — Tier ohne Zustand (LLH-1343)', () => {
  it('zeichnet das Tier ohne Zustand aus @einsatzzeichen: die Silhouette, als abgeleitet gekennzeichnet', () => {
    const z = tierZeichen();
    expect(z).not.toBeNull();
    expect(z!.spec).toEqual({ kind: 'animal-state' });
    // Kein Original zeigt ein Tier ohne Zustand; die Bibliothek sagt das selbst.
    expect(z!.drawing.derivations?.length).toBeGreaterThan(0);
    expect(z!.drawing.children).toHaveLength(1);
    expect(z!.schluessel).toBe('ez|{"v":1,"freestanding":{"kind":"animal-state"}}');
  });

  it('ist für jedes Tier dasselbe Bild (gecacht)', () => {
    expect(tierZeichen()).toBe(tierZeichen());
  });
});
