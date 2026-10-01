import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import Markdown from '../../components/Markdown';
import type { Einheit, Einsatzabschnitt, Stabsfunktion } from '../../api/types';
import { baueFunkplan, type FunkplanZeile } from '../../stab/funkplan';
import { abschnittStaerken } from './abschnittStaerke';
import {
  baueFuehrungsorganisation,
  rendereFuehrungsorganisationMarkdown,
  type OrgKnoten,
} from './fuehrungsorganisation';

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

describe('rendereFuehrungsorganisationMarkdown', () => {
  const abschnitte = [
    abschnitt(1, { name: 'EA Nord', kurzbezeichnung: 'EA-N', leiter_name: 'Anna Leiter' }),
    abschnitt(2, { name: 'UA Deich', ueber_abschnitt_id: 1 }),
  ];
  const einheiten = [
    einheit(
      10,
      {
        name: '1. Zug',
        abschnitt_id: 2,
        funkrufname: 'Florian 1/10',
        fuehrer_name: 'Bernd Führer',
        erreichbarkeit: '0160 GEHEIM',
      },
      [1, 2, 6],
    ),
    einheit(20, { name: 'Lose Gruppe' }),
  ];

  it('schreibt Kopf, Einsatzleitung und die Gliederung in Baumtiefe', () => {
    const md = rendereFuehrungsorganisationMarkdown(
      baueFuehrungsorganisation(abschnitte, einheiten),
      {
        stand: '011200Okt26',
        stab: null,
        einheitenZustand: 'daten',
      },
    );
    expect(md.startsWith('# Führungsorganisation\n')).toBe(true);
    expect(md).toContain('**Stand:** 011200Okt26');
    expect(md).toContain('## Einsatzleitung\n\n- Leitung nicht erfasst\n');
    expect(md).not.toContain('Stab:');
    expect(md).not.toContain('## Quellen');
    expect(md).toContain('- **EA Nord** · Rufname EA-N · Leitung Anna Leiter · Stärke 1/2/6//9');
    expect(md).toContain(
      '  - **UA Deich** · kein Rufname · Leitung nicht besetzt · Stärke 1/2/6//9',
    );
    expect(md).toContain(
      '    - **1. Zug** · Rufname Florian 1/10 · Leitung Bernd Führer · Stärke 1/2/6//9',
    );
    expect(md).toContain(
      '- Ohne Abschnitt\n  - **Lose Gruppe** · kein Rufname · Leitung nicht besetzt · Stärke 0/0/0//0',
    );
    // Personenbezogen: nie im Lagebericht.
    expect(md).not.toContain('GEHEIM');
  });

  it('nennt den Stab nur, wenn er übergeben wird, in S-Folge mit Besetzung', () => {
    const org = baueFuehrungsorganisation(abschnitte, einheiten);
    const besetzung = [
      {
        sachgebiet: 's2',
        besetzung_art: 'personal',
        name: 'Clara Lage',
        personal_noch_disponiert: true,
      },
      { sachgebiet: 's1', besetzung_art: 'einsatzleitung', personal_noch_disponiert: false },
    ] as unknown as Stabsfunktion[];
    const md = rendereFuehrungsorganisationMarkdown(org, {
      stand: 'x',
      stab: besetzung,
      einheitenZustand: 'daten',
    });
    expect(md).toContain('- Stab: S1 Einsatzleitung · S2 Clara Lage\n');
    const leer = rendereFuehrungsorganisationMarkdown(org, {
      stand: 'x',
      stab: [],
      einheitenZustand: 'daten',
    });
    expect(leer).toContain('- Stab: kein Sachgebiet besetzt\n');
  });

  it('nennt fehlende Einheiten als Quelle und schreibt die Stärke als „—“', () => {
    const md = rendereFuehrungsorganisationMarkdown(baueFuehrungsorganisation(abschnitte, null), {
      stand: 'x',
      stab: null,
      einheitenZustand: 'gesperrt',
    });
    expect(md).toContain(
      '## Quellen\n\n- Einheiten: nicht freigegeben — Einheiten und Stärken fehlen',
    );
    expect(md).toContain('- **EA Nord** · Rufname EA-N · Leitung Anna Leiter · Stärke —');
  });

  it('schreibt ohne Abschnitte einen Leervermerk statt einer leeren Liste', () => {
    const md = rendereFuehrungsorganisationMarkdown(baueFuehrungsorganisation([], []), {
      stand: 'x',
      stab: null,
      einheitenZustand: 'daten',
    });
    expect(md).toContain('## Gliederung\n\n_(keine Abschnitte und keine Einheiten erfasst)_');
  });

  it('übernimmt Namen als Text, nie als Auszeichnung', () => {
    const md = rendereFuehrungsorganisationMarkdown(
      baueFuehrungsorganisation([abschnitt(1, { name: '*Nord* [alt]', leiter_name: '_Kai_' })], []),
      { stand: 'x', stab: null, einheitenZustand: 'daten' },
    );
    const { container } = render(createElement(Markdown, { unterEbene: 1, children: md }));
    expect(container.textContent).toContain('*Nord* [alt]');
    expect(container.textContent).toContain('_Kai_');
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});
