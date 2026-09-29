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
import { fachobjektZeichen } from './fachobjektZeichen';

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
    // Seit @einsatzzeichen 3.0.0 randbündig (vermessene Körperfassung C.1.4); die Box lehnt die
    // Bibliothek dort ab (`capabilities-pictogram-has-measured-rendition`).
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
  [
    'Führungskraft Notarzt: ohne Fachaufgabe und ohne Funktionsindikator',
    baueTzProps({
      objekttyp: 'fuehrung',
      organisation: 'hilfsorganisation',
      funktion: 'Notarzt',
      istFuehrungskraft: true,
    }),
    { kind: 'person', organization: 'hilfsorganisation' },
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
  [
    'UHS Behandlungsplatz',
    uhsTz('behandlungsplatz'),
    { kind: 'circle-12', organization: 'hilfsorganisation', bodyMarks: ['physician'] },
  ],
  ...(['patientenablage', 'verletztensammelstelle', 'sonstige'] as UhsTyp[]).map(
    (typ): [string, TzProps, SymbolSpec] => [
      `UHS ${typ}`,
      uhsTz(typ),
      { kind: 'circle-12', organization: 'hilfsorganisation', bodyMarks: ['medical-service'] },
    ],
  ),
  [
    'Betreuungsstelle',
    betreuungsstelleTz(),
    { kind: 'circle-12', organization: 'hilfsorganisation', bodyMarks: ['care'] },
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

  it('lässt eine am Kfz nicht darstellbare Fachaufgabe weg', () => {
    // IuK ist am Kraftfahrzeug weder randbündig noch als Box vermessen.
    expect(
      wirksam({
        grundzeichen: 'kraftfahrzeug-landgebunden',
        organisation: 'hilfsorganisation',
        fachaufgabe: 'iuk',
      }),
    ).toEqual({
      kind: 'vehicle-land',
      vehicleCategory: 'kfz-kategorie-1',
      organization: 'hilfsorganisation',
    });
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
    expect(
      wirksam({
        grundzeichen: 'kraftfahrzeug-landgebunden',
        organisation: 'hilfsorganisation',
        fachaufgabe: 'aerztliche-versorgung',
      }),
    ).toEqual({
      kind: 'vehicle-land',
      bodyVariant: 'plain-wheel-pair',
      organization: 'hilfsorganisation',
      bodyMarks: ['physician'],
    });
  });

  it('behält bei nicht darstellbarer Versorgungsmarke wenigstens das Fußband', () => {
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

  it('fällt bis auf den Körper allein zurück, wenn auch die Füllung nicht passt', () => {
    // Das Ereignis nimmt keine Füllung: erst „Körper allein“ zeichnet.
    expect(wirksam({ grundzeichen: 'anlass', farbe: AUSMASS_FARBE.katastrophal })).toEqual({
      kind: 'event',
    });
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

// Drift-Wache: welche Fachaufgaben des Hub-Vokabulars die Bibliothek am Körper NICHT zeichnet
// (Rückfall ohne Fachaufgabe). Ändert ein Update von @einsatzzeichen die Komponierbarkeit, wird das
// hier in BEIDE Richtungen rot — ein stiller Verlust genauso wie ein neu darstellbares Paar, das
// dann in design.md D2 und die Abbildungspins gehört (Stand core 3.0.0, 29.09.2026).
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

  it('an der Formation (Feuerwehr, Gruppe)', () => {
    expect(
      ohneFachaufgabe({
        grundzeichen: 'taktische-formation',
        organisation: 'feuerwehr',
        einheit: 'gruppe',
      }),
    ).toEqual([
      'hoehenrettung',
      'heben',
      'entschaerfen',
      'sprengen',
      'beleuchtung',
      'transport',
      'umweltschaeden-gewaesser',
      'krankenhaus',
      'seelsorge',
      'fuehrung',
      'pumpen',
    ]);
  });

  it('am Kraftfahrzeug (Feuerwehr)', () => {
    expect(
      ohneFachaufgabe({ grundzeichen: 'kraftfahrzeug-landgebunden', organisation: 'feuerwehr' }),
    ).toEqual([
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
      'versorgung-trinkwasser',
      'versorgung-brauchwasser',
      'instandhaltung',
      'fuehrung',
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
