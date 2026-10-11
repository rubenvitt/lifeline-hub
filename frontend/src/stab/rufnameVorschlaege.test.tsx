import { describe, expect, it } from 'vitest';
import type { EinsatzFahrzeug, Fahrzeug } from '../api/types';
import { DEMO_GROUP } from '../stammdaten/demoAuswahl';
import {
  RUFNAME_GROUP,
  rufnameFilter,
  rufnameOptions,
  rufnamePlaceholder,
  rufnameVorschlaege,
} from './rufnameVorschlaege';

function disponiert(
  id: number,
  funkrufname: string,
  fahrzeugtyp: string | null,
  extra: Partial<EinsatzFahrzeug> = {},
): EinsatzFahrzeug {
  return {
    id,
    einsatz_id: 7,
    funkrufname,
    fahrzeugtyp,
    disponiert_at: '2026-10-09T10:00:00',
    ist_adhoc: false,
    ist_demo: false,
    ...extra,
  };
}

function stamm(
  id: number,
  funkrufname: string,
  fahrzeugtyp: string | null,
  extra: Partial<Fahrzeug> = {},
): Fahrzeug {
  return {
    id,
    funkrufname,
    fahrzeugtyp,
    angelegt_at: '2026-01-01T00:00:00',
    dienststatus: 'in_dienst',
    ist_demo: false,
    sondersignal: false,
    ...extra,
  };
}

/** Gruppen als „Titel: Rufname, Rufname“ — liest sich im Fehlerfall wie die Liste. */
function readable(gruppen: ReturnType<typeof rufnameVorschlaege>): string[] {
  return gruppen.map((g) => `${g.title}: ${g.vorschlaege.map((v) => v.funkrufname).join(', ')}`);
}

const einsatzFahrzeuge = [
  disponiert(1, 'Florian Musterstadt 19/1', 'MTW', { fahrzeug_id: 101 }),
  disponiert(2, 'Florian Musterstadt 11/1', 'ELW 1', { fahrzeug_id: 102 }),
  disponiert(3, 'Heros Musterstadt 10/1', 'ELW 2', { fahrzeug_id: 103 }),
  disponiert(4, 'Florian Musterstadt 44/1', 'HLF 20', { fahrzeug_id: 104 }),
];

const orgFahrzeuge = [
  stamm(102, 'Florian Musterstadt 11/1', 'ELW 1'),
  stamm(105, 'Demo ELW', 'ELW 1', { ist_demo: true }),
  stamm(106, 'Kater Musterstadt 1', 'KdoW'),
  stamm(107, 'Florian Musterstadt 23/1', 'LF 20'),
  stamm(108, 'Rotkreuz Musterstadt 10/1', 'ELW 2'),
];

describe('rufnameVorschlaege (LFH-1187)', () => {
  it('Gruppen in fester Folge: Führungsstelle, disponiert, Organisation, Demo-Daten zuletzt', () => {
    const gruppen = rufnameVorschlaege({
      fahrzeugIds: [1],
      disponiert: einsatzFahrzeuge,
      stamm: orgFahrzeuge,
    });
    expect(readable(gruppen)).toEqual([
      `${RUFNAME_GROUP.fuehrungsstelle}: Florian Musterstadt 19/1`,
      `${RUFNAME_GROUP.disponiert}: Florian Musterstadt 11/1, Heros Musterstadt 10/1`,
      `${RUFNAME_GROUP.organisation}: Kater Musterstadt 1, Rotkreuz Musterstadt 10/1`,
      `${DEMO_GROUP}: Demo ELW`,
    ]);
  });

  it('der Führungsstelle zugeordnet zählt ohne Fachaufgabe Führung, sonst nur Führungsfahrzeuge', () => {
    const gruppen = rufnameVorschlaege({
      fahrzeugIds: [4],
      disponiert: einsatzFahrzeuge,
      stamm: null,
    });
    expect(gruppen[0].vorschlaege.map((v) => v.funkrufname)).toEqual(['Florian Musterstadt 44/1']);
    // MTW und LF sind keine Führungsfahrzeuge und fehlen ohne Zuordnung.
    expect(readable(gruppen).join('\n')).not.toContain('19/1');
  });

  it('ein manuelles Zeichen mit Fachaufgabe Führung gilt wie in der Skizze', () => {
    const gruppen = rufnameVorschlaege({
      fahrzeugIds: [],
      disponiert: [
        disponiert(9, 'Florian Musterstadt 19/2', 'MTW', { tz_fachaufgabe: 'fuehrung' }),
      ],
      stamm: null,
    });
    expect(readable(gruppen)).toEqual([`${RUFNAME_GROUP.disponiert}: Florian Musterstadt 19/2`]);
  });

  it('ohne Freigabe der Fahrzeuge keine Gruppe 1–2, die Organisation bleibt ganz', () => {
    const gruppen = rufnameVorschlaege({ fahrzeugIds: [1], disponiert: null, stamm: orgFahrzeuge });
    expect(gruppen.map((g) => g.title)).toEqual([RUFNAME_GROUP.organisation, DEMO_GROUP]);
    // Ohne Disposition ist auch das disponierte ELW 1 nur ein Fahrzeug der Organisation.
    expect(gruppen[0].vorschlaege.map((v) => v.funkrufname)).toContain('Florian Musterstadt 11/1');
  });

  it('ohne Stammdaten keine Gruppe 3; ohne jede Quelle nichts', () => {
    expect(
      rufnameVorschlaege({ fahrzeugIds: [], disponiert: einsatzFahrzeuge, stamm: null }).map(
        (g) => g.title,
      ),
    ).toEqual([RUFNAME_GROUP.disponiert]);
    expect(rufnameVorschlaege({ fahrzeugIds: [], disponiert: null, stamm: null })).toEqual([]);
  });

  it('ein disponiertes Fahrzeug fehlt in der Organisation, auch unter geändertem Stammnamen', () => {
    const gruppen = rufnameVorschlaege({
      fahrzeugIds: [],
      disponiert: einsatzFahrzeuge,
      stamm: [stamm(103, 'Heros Musterstadt 10-1', 'ELW 2')],
    });
    expect(readable(gruppen)).toEqual([
      `${RUFNAME_GROUP.disponiert}: Florian Musterstadt 11/1, Heros Musterstadt 10/1`,
    ]);
  });

  it('ein Funkrufname steht nur einmal, in der ersten Gruppe; leere fallen weg', () => {
    const gruppen = rufnameVorschlaege({
      fahrzeugIds: [],
      disponiert: [
        disponiert(1, 'Florian 10/1 ', 'ELW 2', { ist_adhoc: true }),
        disponiert(2, '  ', 'ELW 1'),
      ],
      stamm: [stamm(200, 'Florian 10/1', 'ELW 2')],
    });
    expect(readable(gruppen)).toEqual([`${RUFNAME_GROUP.disponiert}: Florian 10/1`]);
  });

  it('der Typ steht neben dem Funkrufnamen, Demo-Herkunft bleibt sichtbar', () => {
    const [gruppe] = rufnameVorschlaege({
      fahrzeugIds: [],
      disponiert: [disponiert(1, 'Demo 10/1', 'ELW 2', { ist_demo: true })],
      stamm: null,
    });
    expect(gruppe.vorschlaege).toEqual([{ funkrufname: 'Demo 10/1', typ: 'ELW 2', isDemo: true }]);
  });
});

describe('rufnamePlaceholder (LFH-1187)', () => {
  it('genau ein zugeordnetes Fahrzeug → dessen Funkrufname', () => {
    expect(rufnamePlaceholder([3], einsatzFahrzeuge)).toBe('Heros Musterstadt 10/1');
  });

  it('keins, mehrere, entlassen oder ohne Freigabe → kein Vorschlag', () => {
    expect(rufnamePlaceholder([], einsatzFahrzeuge)).toBeUndefined();
    expect(rufnamePlaceholder([2, 3], einsatzFahrzeuge)).toBeUndefined();
    expect(rufnamePlaceholder([999], einsatzFahrzeuge)).toBeUndefined();
    expect(rufnamePlaceholder([3], null)).toBeUndefined();
  });
});

describe('rufnameFilter (LFH-1187)', () => {
  const [gruppe] = rufnameOptions([
    {
      title: RUFNAME_GROUP.disponiert,
      vorschlaege: [{ funkrufname: 'Heros Musterstadt 10/1', typ: 'ELW 2', isDemo: false }],
    },
  ]);
  const option = gruppe.options[0];

  it('Wert ist der Funkrufname exakt', () => {
    expect(option.value).toBe('Heros Musterstadt 10/1');
  });

  it('trifft Funkrufname und Typ ohne Groß-/Kleinschreibung', () => {
    expect(rufnameFilter('heros', option)).toBe(true);
    expect(rufnameFilter('10/1', option)).toBe(true);
    expect(rufnameFilter('elw', option)).toBe(true);
    expect(rufnameFilter('Kater', option)).toBe(false);
  });

  it('eine Gruppe trifft nie selbst, damit rc-select ihre Optionen einzeln prüft', () => {
    expect(rufnameFilter('Disponierte', gruppe)).toBe(false);
  });
});
