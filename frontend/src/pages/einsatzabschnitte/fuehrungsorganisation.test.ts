import { describe, expect, it } from 'vitest';
import type { Einheit, Einsatzabschnitt } from '../../api/types';
import { baueFunkplan, type FunkplanZeile } from '../../stab/funkplan';
import { abschnittStaerken } from './abschnittStaerke';
import { baueFuehrungsorganisation, type OrgKnoten } from './fuehrungsorganisation';

function abschnitt(id: number, p: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt {
  return { id, einsatz_id: 1, name: `Abschnitt ${id}`, sortier: id, sprechgruppen: [], ...p };
}

function einheit(
  id: number,
  p: Partial<Einheit> = {},
  staerke: [number, number, number] = [0, 0, 0],
) {
  const s = { fuehrer: staerke[0], unterfuehrer: staerke[1], mannschaft: staerke[2] };
  return {
    id,
    einsatz_id: 1,
    name: `Einheit ${id}`,
    sortier: id,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: s,
    ist_kumuliert: s,
    status: { quelle: 'ohne', verteilung: [] },
    ...p,
  } as Einheit;
}

/** Der Baum als verschachtelte Schlüssel — vergleicht die Platzierung ohne Inhalt. */
type Schluesselbaum = [string, Schluesselbaum[]];
function schluessel(k: OrgKnoten): Schluesselbaum {
  return [k.key, k.kinder.map(schluessel)];
}
function funkplanSchluessel(z: FunkplanZeile): Schluesselbaum {
  return [z.key, (z.children ?? []).filter((c) => c.art !== 'fahrzeug').map(funkplanSchluessel)];
}

function finde(knoten: readonly OrgKnoten[], key: string): OrgKnoten | undefined {
  for (const k of knoten) {
    if (k.key === key) return k;
    const t = finde(k.kinder, key);
    if (t) return t;
  }
  return undefined;
}

describe('baueFuehrungsorganisation — Knotenaufbau', () => {
  it('stellt oberste Abschnitte an die Wurzel, Unterabschnitte vor Einheiten', () => {
    const org = baueFuehrungsorganisation(
      [abschnitt(1), abschnitt(2, { ueber_abschnitt_id: 1 }), abschnitt(3)],
      [einheit(10, { abschnitt_id: 1 })],
    );
    expect(org.wurzeln.map(schluessel)).toEqual([
      [
        'ab-1',
        [
          ['ab-2', []],
          ['eh-10', []],
        ],
      ],
      ['ab-3', []],
    ]);
  });

  it('hängt eine unterstellte Einheit unter ihre Einheit, nicht unter den Abschnitt', () => {
    const org = baueFuehrungsorganisation(
      [abschnitt(1)],
      [einheit(10, { abschnitt_id: 1 }), einheit(11, { abschnitt_id: 1, ueber_einheit_id: 10 })],
    );
    expect(org.wurzeln.map(schluessel)).toEqual([['ab-1', [['eh-10', [['eh-11', []]]]]]]);
  });

  it('macht Waisen zu Wurzeln bzw. obersten Einheiten', () => {
    const org = baueFuehrungsorganisation(
      [abschnitt(2, { ueber_abschnitt_id: 99 })],
      [einheit(11, { abschnitt_id: 2, ueber_einheit_id: 98 })],
    );
    expect(org.wurzeln.map(schluessel)).toEqual([['ab-2', [['eh-11', []]]]]);
  });

  it('sammelt Einheiten ohne Abschnitt unter „Ohne Abschnitt“ — nur, wenn es welche gibt', () => {
    const mit = baueFuehrungsorganisation(
      [abschnitt(1)],
      [einheit(10, { abschnitt_id: null }), einheit(11, { abschnitt_id: 77 })],
    );
    expect(mit.wurzeln.map(schluessel)).toEqual([
      ['ab-1', []],
      [
        'sammel',
        [
          ['eh-10', []],
          ['eh-11', []],
        ],
      ],
    ]);
    const ohne = baueFuehrungsorganisation([abschnitt(1)], [einheit(10, { abschnitt_id: 1 })]);
    expect(ohne.wurzeln.some((k) => k.art === 'sammel')).toBe(false);
  });

  it('übersteht einen Zyklus und nimmt jeden Knoten höchstens einmal auf', () => {
    const org = baueFuehrungsorganisation(
      [
        abschnitt(1, { ueber_abschnitt_id: 2 }),
        abschnitt(2, { ueber_abschnitt_id: 1 }),
        abschnitt(3),
      ],
      [
        einheit(10, { abschnitt_id: 3, ueber_einheit_id: 11 }),
        einheit(11, { abschnitt_id: 3, ueber_einheit_id: 10 }),
      ],
    );
    const alle: string[] = [];
    const sammle = (k: OrgKnoten) => {
      alle.push(k.key);
      k.kinder.forEach(sammle);
    };
    org.wurzeln.forEach(sammle);
    expect(new Set(alle).size).toBe(alle.length);
    expect(alle).toEqual(expect.arrayContaining(['ab-1', 'ab-2', 'ab-3', 'eh-10', 'eh-11']));
  });
});

describe('baueFuehrungsorganisation — Knoteninhalt', () => {
  it('trägt Rufname und Leitung aus den Daten, fehlende als null — nie geraten', () => {
    const org = baueFuehrungsorganisation(
      [
        abschnitt(1, { kurzbezeichnung: 'EA-N', leiter_name: 'Vitt' }),
        abschnitt(2, { ueber_abschnitt_id: 1 }),
      ],
      [
        einheit(10, { abschnitt_id: 2, funkrufname: 'Florian 1', fuehrer_name: 'Muster' }),
        einheit(11, { abschnitt_id: 2 }),
      ],
    );
    const a1 = finde(org.wurzeln, 'ab-1')!;
    const a2 = finde(org.wurzeln, 'ab-2')!;
    const e10 = finde(org.wurzeln, 'eh-10')!;
    const e11 = finde(org.wurzeln, 'eh-11')!;
    expect(a1).toMatchObject({
      art: 'abschnitt',
      name: 'Abschnitt 1',
      rufname: 'EA-N',
      leitung: 'Vitt',
    });
    expect(a2).toMatchObject({ rufname: null, leitung: null });
    expect(e10).toMatchObject({ art: 'einheit', rufname: 'Florian 1', leitung: 'Muster' });
    expect(e11).toMatchObject({ name: 'Einheit 11', rufname: null, leitung: null });
  });

  it('leitet die Zeichen wie die Lagekarte ab', () => {
    const org = baueFuehrungsorganisation(
      [abschnitt(1, { tz_organisation: 'thw' })],
      [einheit(10, { abschnitt_id: 1, typ_label: 'Zug' })],
    );
    const a = finde(org.wurzeln, 'ab-1')!;
    const e = finde(org.wurzeln, 'eh-10')!;
    expect(a.art === 'abschnitt' && a.tz).toMatchObject({
      grundzeichen: 'befehlsstelle',
      organisation: 'thw',
    });
    expect(e.art === 'einheit' && e.tz).toMatchObject({
      grundzeichen: 'taktische-formation',
      einheit: 'zug',
    });
  });

  it('meldet fehlende Einheiten: Abschnitte ohne Stärke, kein „Ohne Abschnitt“', () => {
    const org = baueFuehrungsorganisation(
      [abschnitt(1), abschnitt(2, { ueber_abschnitt_id: 1 })],
      null,
    );
    expect(org.einheitenFehlen).toBe(true);
    expect(org.wurzeln.map(schluessel)).toEqual([['ab-1', [['ab-2', []]]]]);
    expect(finde(org.wurzeln, 'ab-1')).toMatchObject({ staerke: null });
  });
});

describe('baueFuehrungsorganisation — Stärke aus derselben Rechnung wie der Gliederungsbaum', () => {
  const abschnitte = [
    abschnitt(1),
    abschnitt(2, { ueber_abschnitt_id: 1 }),
    abschnitt(3, { ueber_abschnitt_id: 1 }),
    abschnitt(4),
  ];
  const einheiten = [
    einheit(10, { abschnitt_id: 2 }, [1, 1, 4]),
    // unterstellt unter 10, mit eigener kumulierter Stärke — zählt nicht doppelt
    einheit(11, { abschnitt_id: 2, ueber_einheit_id: 10 }, [0, 1, 2]),
    einheit(12, { abschnitt_id: 3 }, [0, 1, 5]),
  ];
  const org = baueFuehrungsorganisation(abschnitte, einheiten);

  it.each([1, 2, 3, 4])('Abschnitt %i zeigt den Wert des Gliederungsbaums', (id) => {
    expect(finde(org.wurzeln, `ab-${id}`)).toMatchObject({
      staerke: abschnittStaerken(abschnitte, einheiten, id).inklUnter,
    });
  });

  it('Abschnitt ohne Einheiten hat null, nicht 0/0/0', () => {
    expect(finde(org.wurzeln, 'ab-4')).toMatchObject({ staerke: null });
  });

  it('Einheit zeigt ihre kumulierte Ist-Stärke', () => {
    expect(finde(org.wurzeln, 'eh-11')).toMatchObject({
      staerke: { fuehrer: 0, unterfuehrer: 1, mannschaft: 2 },
    });
  });
});

describe('baueFuehrungsorganisation — dieselbe Platzierung wie der Funkplan', () => {
  it('ergibt denselben Abschnitt/Einheit-Baum wie baueFunkplan ohne Fahrzeuge', () => {
    const abschnitte = [
      abschnitt(1),
      abschnitt(2, { ueber_abschnitt_id: 1 }),
      abschnitt(3, { ueber_abschnitt_id: 42 }),
      abschnitt(4),
    ];
    const einheiten = [
      einheit(10, { abschnitt_id: 1 }),
      einheit(11, { abschnitt_id: 2, ueber_einheit_id: 10 }),
      einheit(12, { abschnitt_id: 2 }),
      einheit(13, { abschnitt_id: null }),
      einheit(14, { abschnitt_id: 3, ueber_einheit_id: 99 }),
    ];
    const daten = <T>(d: T[]) => ({ zustand: 'daten' as const, daten: d });
    const funkplan = baueFunkplan({
      abschnitte: daten(abschnitte),
      einheiten: daten(einheiten),
      fahrzeuge: daten([]),
      personal: daten([]),
      sprechgruppen: daten([]),
    });
    const org = baueFuehrungsorganisation(abschnitte, einheiten);
    expect(org.wurzeln.map(schluessel)).toEqual(funkplan.map(funkplanSchluessel));
  });
});
