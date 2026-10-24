import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import type {
  Einheit,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Fahrzeug,
  ModulFreigaben,
  Personal,
} from '../../api/types';
import {
  besatzungGrund,
  buildBesatzungMittel,
  buildEinheitRechte,
  buildFahrzeugZuordnenGroups,
  buildPersonMenuItems,
  buildPersonZuordnenGroups,
  collectNachfahren,
  toKraftError,
  parseZuordnenWert,
  visibleBesatzungRows,
  type EinheitRechte,
} from './einheitAnsichtKern';

const einheit = (id: number, ueber: number | null) =>
  ({ id, ueber_einheit_id: ueber }) as unknown as Einheit;

describe('collectNachfahren', () => {
  it('nimmt die Einheit selbst und eine Kette darunter', () => {
    const bestand = [einheit(1, null), einheit(2, 1), einheit(3, 2), einheit(4, null)];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3]);
  });

  it('folgt jeder Verzweigung, nicht den Geschwistern darüber', () => {
    const bestand = [
      einheit(1, null),
      einheit(2, 1),
      einheit(3, 1),
      einheit(4, 3),
      einheit(5, null),
    ];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3, 4]);
    expect([...collectNachfahren(bestand, 3)].sort()).toEqual([3, 4]);
  });

  it('bricht an einem Kreis im Bestand nicht', () => {
    const bestand = [einheit(1, 3), einheit(2, 1), einheit(3, 2)];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3]);
  });
});

/** Freigaben wie `GET …/modul-freigaben`: nur `zugriff` zählt, hier für die vier Module. */
function freigaben(gesperrt: string[] = []): ModulFreigaben {
  return Object.fromEntries(
    ['einheiten', 'personal', 'fahrzeuge', 'material'].map((key) => [
      key,
      { zugriff: !gesperrt.includes(key) },
    ]),
  ) as unknown as ModulFreigaben;
}

const ALLES: EinheitRechte = {
  canEditEinheit: true,
  canZuordnenPersonalEinsatz: true,
  canZuordnenPersonalStamm: true,
  canZuordnenFahrzeugEinsatz: true,
  canZuordnenFahrzeugStamm: true,
  canEditBesatzung: true,
  showMaterialAuswahl: true,
  hasPersonalLink: true,
  hasFahrzeugLink: true,
  hasBesatzung: true,
  hasMaterialListe: true,
};

/** Die Tabelle aus design.md D6, Zeile für Zeile. */
describe('buildEinheitRechte (design.md D6)', () => {
  it('mit Schreibrecht und allen Freigaben ist alles offen', () => {
    expect(buildEinheitRechte(true, freigaben())).toEqual(ALLES);
  });

  it('unbekannte Freigaben heißen offen (wie `istSprungGesperrt`)', () => {
    expect(buildEinheitRechte(true, undefined)).toEqual(ALLES);
  });

  it('Beobachter: kein Bedienelement, nur die Links in freigegebene Module', () => {
    expect(buildEinheitRechte(false, freigaben())).toEqual({
      ...Object.fromEntries(Object.keys(ALLES).map((k) => [k, false])),
      hasPersonalLink: true,
      hasFahrzeugLink: true,
      hasBesatzung: true,
      hasMaterialListe: true,
    });
  });

  it('Personal gesperrt: kein Zuordnen von Personen, kein Link dorthin, der Rest bleibt', () => {
    expect(buildEinheitRechte(true, freigaben(['personal']))).toEqual({
      ...ALLES,
      canZuordnenPersonalEinsatz: false,
      canZuordnenPersonalStamm: false,
      hasPersonalLink: false,
      hasBesatzung: false,
    });
  });

  it('Fahrzeuge gesperrt: kein Zuordnen von Fahrzeugen, keine Besatzung, kein Link dorthin', () => {
    expect(buildEinheitRechte(true, freigaben(['fahrzeuge']))).toEqual({
      ...ALLES,
      canZuordnenFahrzeugEinsatz: false,
      canZuordnenFahrzeugStamm: false,
      canEditBesatzung: false,
      hasFahrzeugLink: false,
      hasBesatzung: false,
    });
  });

  it('Material gesperrt: keine Materialliste, die Auswahl steht gesperrt (Bedienung fällt weg)', () => {
    expect(buildEinheitRechte(true, freigaben(['material']))).toEqual({
      ...ALLES,
      hasMaterialListe: false,
    });
  });

  /** LLH-1225 D9: der Ort gehört dem Material, das Einheitenrecht zählt dafür nicht. */
  it('Einheiten gesperrt: alles, was die Einheit schreibt, fällt weg; Besatzung, Material und Links bleiben', () => {
    expect(buildEinheitRechte(true, freigaben(['einheiten']))).toEqual({
      ...Object.fromEntries(Object.keys(ALLES).map((k) => [k, false])),
      canEditBesatzung: true,
      showMaterialAuswahl: true,
      hasPersonalLink: true,
      hasFahrzeugLink: true,
      hasBesatzung: true,
      hasMaterialListe: true,
    });
  });
});

describe('besatzungGrund (design.md D5)', () => {
  it('nennt jedes gesperrte Modul der Besatzung, sonst nichts', () => {
    expect(besatzungGrund(buildEinheitRechte(true, freigaben()))).toBeNull();
    expect(besatzungGrund(buildEinheitRechte(true, freigaben(['personal'])))).toBe(
      'Modul Personal gesperrt',
    );
    expect(besatzungGrund(buildEinheitRechte(true, freigaben(['fahrzeuge'])))).toBe(
      'Modul Fahrzeuge gesperrt',
    );
    expect(besatzungGrund(buildEinheitRechte(true, freigaben(['personal', 'fahrzeuge'])))).toBe(
      'Module Personal und Fahrzeuge gesperrt',
    );
    // Der Beobachter sieht die Besatzung, er bedient sie nur nicht.
    expect(besatzungGrund(buildEinheitRechte(false, freigaben()))).toBeNull();
  });
});

const ep = (id: number, teil: Partial<EinsatzPersonal> = {}) =>
  ({ id, name: `Person ${id}`, einheit_id: null, personal_id: null, ...teil }) as EinsatzPersonal;
const stammPerson = (id: number, teil: Partial<Personal> = {}) =>
  ({
    id,
    name: `Stamm ${id}`,
    ist_demo: false,
    personalnummer: null,
    traegerorganisation: null,
    qualifikationen: [],
    ...teil,
  }) as unknown as Personal;

/** Auswahlgruppen „Person zuordnen …“ (design.md D7). */
describe('buildPersonZuordnenGroups (D7)', () => {
  it('trennt Einsatz- und Stamm-Werte, auch bei gleicher Zahl', () => {
    const groups = buildPersonZuordnenGroups({
      einsatz: [ep(5, { name: 'Erika Frei' })],
      stamm: [stammPerson(5, { name: 'Otto Stamm' })],
      canEinsatz: true,
      canStamm: true,
    });
    expect(groups.map((g) => [g.key, g.title])).toEqual([
      ['einsatz', 'Im Einsatz frei'],
      ['stamm', 'Aus dem Stamm'],
    ]);
    const [einsatz, stamm] = groups;
    expect(einsatz.entries.map((e) => e.value)).toEqual(['einsatz:5']);
    expect(stamm.entries.map((e) => e.value)).toEqual(['stamm:5']);
    expect(parseZuordnenWert('einsatz:5')).toEqual({ source: 'einsatz', id: 5 });
    expect(parseZuordnenWert('stamm:5')).toEqual({ source: 'stamm', id: 5 });
    expect(parseZuordnenWert('5')).toBeNull();
    expect(parseZuordnenWert('stamm:x')).toBeNull();
  });

  it('im Einsatz nur Kräfte ohne Einheit; aktiv Disponierte und Entlassene fallen aus dem Stamm', () => {
    const groups = buildPersonZuordnenGroups({
      einsatz: [
        ep(1, { personal_id: 11 }),
        ep(2, { personal_id: 12, einheit_id: 9 }),
        ep(3, { personal_id: 13, beendet_at: '2026-10-14T08:00:00Z' }),
      ],
      entlassene: [ep(4, { personal_id: 14, beendet_at: '2026-10-14T08:00:00Z' })],
      stamm: [11, 12, 13, 14, 15].map((id) => stammPerson(id)),
      canEinsatz: true,
      canStamm: true,
    });
    expect(groups[0].entries.map((e) => e.value)).toEqual(['einsatz:1']);
    // 13 steht als beendete Zeile noch in der Liste; der Kern sieht sie als vergeben wie 14.
    expect(groups[1].entries.map((e) => e.value)).toEqual(['stamm:15']);
  });

  it('Demo-Stammdaten stehen als eigene Gruppe hinten', () => {
    const groups = buildPersonZuordnenGroups({
      einsatz: [],
      stamm: [
        stammPerson(1, { ist_demo: true }),
        stammPerson(2),
        stammPerson(3, { ist_demo: true }),
      ],
      canEinsatz: true,
      canStamm: true,
    });
    expect(groups.map((g) => [g.key, g.title, g.entries.map((e) => e.value)])).toEqual([
      ['stamm', 'Aus dem Stamm', ['stamm:2']],
      ['demo', 'Demo-Daten', ['stamm:1', 'stamm:3']],
    ]);
  });

  it('sucht über Name, Personalnummer, Träger und Qualifikation', () => {
    const [stamm] = buildPersonZuordnenGroups({
      einsatz: [],
      stamm: [
        stammPerson(1, {
          name: 'Erika Muster',
          personalnummer: 'P-7',
          traegerorganisation: 'DRK',
          qualifikationen: [{ id: 1, label: 'Sanitäter' }] as Personal['qualifikationen'],
        }),
      ],
      canEinsatz: true,
      canStamm: true,
    });
    expect(stamm.entries[0]).toMatchObject({
      label: 'Erika Muster (P-7)',
      suchtext: 'Erika Muster P-7 DRK Sanitäter',
    });
  });

  it('eine Gruppe ohne Recht fällt weg, ohne jedes Recht bleibt nichts', () => {
    const input = { einsatz: [ep(1)], stamm: [stammPerson(2)] };
    expect(
      buildPersonZuordnenGroups({ ...input, canEinsatz: true, canStamm: false }).map((g) => g.key),
    ).toEqual(['einsatz']);
    expect(
      buildPersonZuordnenGroups({ ...input, canEinsatz: false, canStamm: true }).map((g) => g.key),
    ).toEqual(['stamm']);
    expect(buildPersonZuordnenGroups({ ...input, canEinsatz: false, canStamm: false })).toEqual([]);
  });
});

const ef = (id: number, teil: Partial<EinsatzFahrzeug> = {}) =>
  ({
    id,
    funkrufname: `Fzg ${id}`,
    einheit_id: null,
    fahrzeug_id: null,
    ...teil,
  }) as EinsatzFahrzeug;
const stammFahrzeug = (id: number, teil: Partial<Fahrzeug> = {}) =>
  ({ id, funkrufname: `Stamm ${id}`, ist_demo: false, ...teil }) as unknown as Fahrzeug;

describe('buildFahrzeugZuordnenGroups (D8)', () => {
  it('dieselbe Form wie bei Personen: frei im Einsatz, Stamm ohne aktive, Demo hinten', () => {
    const groups = buildFahrzeugZuordnenGroups({
      einsatz: [
        ef(1, { fahrzeug_id: 21, fahrzeugtyp: 'HLF 20', funkrufname: 'Florian 1' }),
        ef(2, { fahrzeug_id: 22, einheit_id: 3 }),
      ],
      stamm: [
        stammFahrzeug(21),
        stammFahrzeug(22),
        stammFahrzeug(23, { fahrzeugtyp: 'RTW' }),
        stammFahrzeug(24, { ist_demo: true }),
      ],
      canEinsatz: true,
      canStamm: true,
    });
    expect(groups.map((g) => [g.key, g.entries.map((e) => [e.value, e.label])])).toEqual([
      ['einsatz', [['einsatz:1', 'Florian 1 (HLF 20)']]],
      ['stamm', [['stamm:23', 'Stamm 23 (RTW)']]],
      ['demo', [['stamm:24', 'Stamm 24']]],
    ]);
  });
});

/** Ein Menü je Person (design.md D9, Spec „Menüeinträge nach Modulrecht“). */
describe('buildPersonMenuItems (D9)', () => {
  const fahrzeuge = [
    { id: 30, funkrufname: '83-1' },
    { id: 31, funkrufname: '83-2' },
  ];
  const alle = { canEditEinheit: true, canEditBesatzung: true };
  const items = (
    person: { isFuehrer: boolean; fahrzeugId: number | null },
    rechte: { canEditEinheit: boolean; canEditBesatzung: boolean } = alle,
  ) => buildPersonMenuItems(person, fahrzeuge, rechte).map((e) => [e.key, e.label, !!e.gefahr]);

  it('Person ohne Fahrzeug: Einheitsführer, auf jedes Fahrzeug, dann rot aus der Einheit', () => {
    expect(items({ isFuehrer: false, fahrzeugId: null })).toEqual([
      ['fuehrer', 'Als Einheitsführer', false],
      ['auf:30', 'Auf 83-1', false],
      ['auf:31', 'Auf 83-2', false],
      ['aus-einheit', 'Aus Einheit lösen', true],
    ]);
  });

  it('der Einheitsführer auf 83-1: kein „Als Einheitsführer“, nur das andere Fahrzeug, Lösen rot', () => {
    expect(items({ isFuehrer: true, fahrzeugId: 30 })).toEqual([
      ['auf:31', 'Auf 83-2', false],
      ['vom-fahrzeug', 'Vom Fahrzeug lösen', true],
      ['aus-einheit', 'Aus Einheit lösen', true],
    ]);
  });

  it('Person auf einem fremden Fahrzeug: auf jedes eigene, vom fremden lösen', () => {
    expect(items({ isFuehrer: false, fahrzeugId: 99 }).map(([k]) => k)).toEqual([
      'fuehrer',
      'auf:30',
      'auf:31',
      'vom-fahrzeug',
      'aus-einheit',
    ]);
  });

  it('ohne Recht auf Fahrzeuge fehlen „Auf …“ und „Vom Fahrzeug lösen“', () => {
    expect(
      items(
        { isFuehrer: false, fahrzeugId: 30 },
        { canEditEinheit: true, canEditBesatzung: false },
      ),
    ).toEqual([
      ['fuehrer', 'Als Einheitsführer', false],
      ['aus-einheit', 'Aus Einheit lösen', true],
    ]);
  });

  it('ohne Recht auf Einheiten bleiben nur die Besatzungswege, ohne jedes Recht nichts', () => {
    expect(
      items(
        { isFuehrer: false, fahrzeugId: 30 },
        { canEditEinheit: false, canEditBesatzung: true },
      ),
    ).toEqual([
      ['auf:31', 'Auf 83-2', false],
      ['vom-fahrzeug', 'Vom Fahrzeug lösen', true],
    ]);
    expect(
      items(
        { isFuehrer: false, fahrzeugId: 30 },
        { canEditEinheit: false, canEditBesatzung: false },
      ),
    ).toEqual([]);
  });
});

describe('toKraftError (D7)', () => {
  it('nimmt den Grund der gewählten Kraft aus `zeilen`, sonst den Fehler selbst', () => {
    const fehler = new ApiError(422, 'Nicht disponiert', {
      zeilen: [
        { art: 'personal', id: 52, grund: 'außer Dienst' },
        { art: 'fahrzeug', id: 52, grund: 'entlassen' },
      ],
    });
    expect((toKraftError(fehler, 'personal', 52) as ApiError).message).toBe('außer Dienst');
    expect((toKraftError(fehler, 'fahrzeug', 52) as ApiError).message).toBe('entlassen');
    expect(toKraftError(fehler, 'personal', 53)).toBe(fehler);
    const fremd = new Error('weg');
    expect(toKraftError(fremd, 'personal', 52)).toBe(fremd);
  });
});

/** Die Zeilen des Paneels, gegen die ein Grund seinen Ort prüft (LLH-1269). */
describe('visibleBesatzungRows', () => {
  const zug = {
    id: 10,
    ueber_einheit_id: null,
    fuehrer_id: null,
    personal_mitglieder: [
      { ep_id: 1, name: 'Anna', staerke_position: null, ist_fuehrer: false },
      { ep_id: 2, name: 'Bernd', staerke_position: null, ist_fuehrer: false },
    ],
    fahrzeug_mitglieder: [{ ef_id: 30, funkrufname: '83-1', fahrzeugtyp: null, status: null }],
  } as unknown as Einheit;
  const personal = [
    ep(1, { name: 'Anna', einheit_id: 10, fahrzeug_id: 30 }),
    ep(2, { name: 'Bernd', einheit_id: 10 }),
  ];
  const fahrzeuge = [{ id: 30, funkrufname: '83-1', einheit_id: 10 } as EinsatzFahrzeug];

  it('mit Besatzung: die Personen auf dem Fahrzeug und ohne Fahrzeug, die Fahrzeuge', () => {
    const rechte = buildEinheitRechte(true, freigaben());
    const rows = visibleBesatzungRows(
      zug,
      buildBesatzungMittel(zug, [zug], personal, fahrzeuge, rechte),
    );
    expect([...rows.personen]).toEqual(
      expect.arrayContaining([
        [1, 'Anna'],
        [2, 'Bernd'],
      ]),
    );
    expect(rows.personen.size).toBe(2);
    expect([...rows.fahrzeuge]).toEqual([[30, '83-1']]);
  });

  it('ohne Freigabe Personal: flach aus dem DTO', () => {
    const rechte = buildEinheitRechte(true, freigaben(['personal']));
    expect(buildBesatzungMittel(zug, [zug], personal, fahrzeuge, rechte)).toBeNull();
    const rows = visibleBesatzungRows(zug, null);
    expect([...rows.personen.keys()]).toEqual([1, 2]);
    expect([...rows.fahrzeuge.keys()]).toEqual([30]);
  });

  it('ohne Mitglieder im DTO: keine Zeile, auch wenn die Listen noch eine führen', () => {
    const leer = { ...zug, personal_mitglieder: [], fahrzeug_mitglieder: [] } as Einheit;
    const rechte = buildEinheitRechte(true, freigaben());
    const rows = visibleBesatzungRows(
      leer,
      buildBesatzungMittel(leer, [leer], personal, fahrzeuge, rechte),
    );
    expect(rows.personen.size + rows.fahrzeuge.size).toBe(0);
  });
});
