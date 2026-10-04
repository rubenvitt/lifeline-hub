import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Markdown from '../components/Markdown';
import type {
  Einheit,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Einsatzabschnitt,
  Fuehrungsstelle,
  Sprechgruppe,
} from '../api/types';
import {
  aufklappbareSchluessel,
  baueFunkplan,
  funkplanLuecken,
  gegenstelleHinweis,
  md,
  rendereFunkplanMarkdown,
  type FunkplanQuellen,
  type FunkplanZeile,
} from './funkplan';
import { fuehrungsstelleErfasst } from './fuehrungsstelle';
import type { Quelle } from './luecken';

/** Namen, die remark-gfm ohne Schutz als Link läse (LFH-868). */
const AUTOLINKS = {
  www: 'www.thw-nord.de',
  gross: 'WWW.Nord.de/fz',
  http: 'https://thw.de/ov?a=1',
  spitz: '<https://x.de>',
  mail: 'ops@thw-nord.de',
} as const;

/** Text, wie ihn ein Mensch sieht: ohne das unsichtbare Wortverbindungszeichen (U+2060). */
const sichtbar = (text: string | null) => (text ?? '').replace(/\u2060/g, '');

function sg(
  id: number,
  betriebsart: 'TMO' | 'DMO',
  bezeichnung: string,
  lokal = false,
): Sprechgruppe {
  return { id, bezeichnung, betriebsart, aktiv: true, einsatz_lokal: lokal, sortier: id };
}

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

function fahrzeug(id: number, p: Partial<EinsatzFahrzeug> = {}): EinsatzFahrzeug {
  return {
    id,
    einsatz_id: 1,
    funkrufname: `Florian ${id}`,
    disponiert_at: '2026-09-30T10:00:00',
    ist_adhoc: false,
    ist_demo: false,
    ...p,
  };
}

function person(id: number, p: Partial<EinsatzPersonal> = {}): EinsatzPersonal {
  return {
    id,
    einsatz_id: 1,
    name: `Person ${id}`,
    disponiert_at: '2026-09-30T10:00:00',
    ist_adhoc: false,
    ist_demo: false,
    ...p,
  };
}

const daten = <T,>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });

function quellen(p: Partial<FunkplanQuellen> = {}): FunkplanQuellen {
  return {
    abschnitte: daten([]),
    einheiten: daten([]),
    fahrzeuge: daten([]),
    personal: daten([]),
    sprechgruppen: daten([]),
    fuehrungsstelle: { zustand: 'daten', daten: null },
    ...p,
  };
}

function fs(p: Partial<Fuehrungsstelle> = {}): FunkplanQuellen['fuehrungsstelle'] {
  return { zustand: 'daten', daten: { sprechgruppen: [], ...p } };
}

function alleSchluessel(zeilen: FunkplanZeile[]): string[] {
  return zeilen.flatMap((z) => [z.key, ...alleSchluessel(z.children ?? [])]);
}

describe('baueFunkplan', () => {
  it('baut Abschnitt → Unterabschnitt → Einheit → Untereinheit → Fahrzeug', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: daten([abschnitt(1), abschnitt(2, { ueber_abschnitt_id: 1 })]),
        einheiten: daten([einheit(10, { abschnitt_id: 2 }), einheit(11, { ueber_einheit_id: 10 })]),
        fahrzeuge: daten([fahrzeug(100, { einheit_id: 11 })]),
      }),
    );
    expect(plan).toHaveLength(1);
    const a1 = plan[0];
    expect([a1.art, a1.key]).toEqual(['abschnitt', 'ab-1']);
    const a2 = a1.children![0];
    expect(a2.key).toBe('ab-2');
    const e10 = a2.children![0];
    expect(e10.key).toBe('eh-10');
    const e11 = e10.children![0];
    expect(e11.key).toBe('eh-11');
    expect(e11.children![0]).toMatchObject({
      key: 'fz-100',
      art: 'fahrzeug',
      stelle: 'Florian 100',
    });
  });

  it('stellt Unterabschnitte vor Einheiten und hält sonst die gelieferte Reihenfolge', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: daten([
          abschnitt(1),
          abschnitt(3, { ueber_abschnitt_id: 1 }),
          abschnitt(2, { ueber_abschnitt_id: 1 }),
        ]),
        einheiten: daten([einheit(10, { abschnitt_id: 1 })]),
      }),
    );
    expect(plan[0].children!.map((z) => z.key)).toEqual(['ab-3', 'ab-2', 'eh-10']);
  });

  it('hebt einen Unterabschnitt ohne geladenen Oberabschnitt an die Wurzel', () => {
    const plan = baueFunkplan(
      quellen({ abschnitte: daten([abschnitt(2, { ueber_abschnitt_id: 99 })]) }),
    );
    expect(plan.map((z) => z.key)).toEqual(['ab-2']);
  });

  it('sammelt Einheiten ohne Abschnitt und Fahrzeuge ohne Einheit im letzten Knoten', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: daten([abschnitt(1)]),
        einheiten: daten([einheit(10), einheit(11, { abschnitt_id: 1 })]),
        fahrzeuge: daten([
          fahrzeug(100, { funkrufname: 'Florian ELW 1' }),
          fahrzeug(101, { einheit_id: 11 }),
        ]),
      }),
    );
    expect(plan.map((z) => z.key)).toEqual(['ab-1', 'sammel']);
    const sammel = plan[1];
    expect(sammel.art).toBe('sammel');
    expect(sammel.stelle).toBe('Ohne Abschnitt / Einheit');
    expect(sammel.children!.map((z) => z.key)).toEqual(['eh-10', 'fz-100']);
  });

  it('lässt den Sammelknoten weg, wenn alles eine Heimat hat', () => {
    const plan = baueFunkplan(quellen({ abschnitte: daten([abschnitt(1)]) }));
    expect(plan.map((z) => z.key)).toEqual(['ab-1']);
  });

  it('hebt Einheiten an die Wurzel, wenn die Abschnitte fehlen, statt sie als heimatlos zu sammeln', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: { zustand: 'gesperrt', daten: [] },
        einheiten: daten([einheit(10, { abschnitt_id: 1 })]),
      }),
    );
    expect(plan.map((z) => z.key)).toEqual(['eh-10']);
  });

  it('hebt Fahrzeuge an die Wurzel, wenn die Einheiten fehlen', () => {
    const plan = baueFunkplan(
      quellen({
        einheiten: { zustand: 'fehler', daten: [] },
        fahrzeuge: daten([fahrzeug(100, { einheit_id: 10 })]),
      }),
    );
    expect(plan.map((z) => z.key)).toEqual(['fz-100']);
  });

  it('lässt eine nicht verfügbare Ebene ganz weg', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: daten([abschnitt(1)]),
        einheiten: daten([einheit(10, { abschnitt_id: 1 })]),
        fahrzeuge: { zustand: 'gesperrt', daten: [] },
      }),
    );
    expect(alleSchluessel(plan)).toEqual(['ab-1', 'eh-10']);
  });

  it('trennt TMO und DMO aus den Zuordnungen und liest nie die eingefrorenen Altfelder', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: daten([
          abschnitt(1, {
            sprechgruppe_tmo: 'ALT-TMO',
            sprechgruppe_dmo: 'ALT-DMO',
            sprechgruppen: [sg(1, 'TMO', '311'), sg(2, 'DMO', '505'), sg(3, 'TMO', '312')],
          }),
        ]),
      }),
    );
    expect(plan[0].tmo).toEqual(['311', '312']);
    expect(plan[0].dmo).toEqual(['505']);
    expect(JSON.stringify(plan)).not.toContain('ALT-');
  });

  it('füllt Stelle und Rufname je Ebene, ohne fehlende Werte zu erraten', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: daten([
          abschnitt(1, {
            name: 'Abschnitt Nord',
            kurzbezeichnung: 'EA-N',
            leiter_name: 'Anna Leiter',
            kommunikationsmittel: 'digitalfunk',
            erreichbarkeit: '0171 1',
          }),
        ]),
        einheiten: daten([
          einheit(10, { name: '1. Zug', abschnitt_id: 1, fuehrer_name: 'Bernd Führer' }),
        ]),
        fahrzeuge: daten([
          fahrzeug(100, {
            einheit_id: 10,
            funkrufname: 'Florian 1/42-1',
            opta: 'FW-1-42-1',
            fahrzeugtyp: 'HLF 20',
          }),
        ]),
      }),
    );
    const [a] = plan;
    expect(a).toMatchObject({
      stelle: 'Abschnitt Nord',
      rufname: 'EA-N',
      leitung: { art: 'name', namen: ['Anna Leiter'] },
      kommunikationsmittel: 'Digitalfunk',
      erreichbarkeit: '0171 1',
    });
    const e = a.children![0];
    expect(e).toMatchObject({
      stelle: '1. Zug',
      rufname: null,
      leitung: { art: 'name', namen: ['Bernd Führer'] },
    });
    const f = e.children![0];
    expect(f).toMatchObject({
      stelle: 'Florian 1/42-1',
      stelleZusatz: 'HLF 20',
      rufname: 'FW-1-42-1',
      kommunikationsmittel: null,
      erreichbarkeit: null,
      tmo: [],
      dmo: [],
    });
  });

  it('liest den Fahrzeugführer aus dem Personal mit Position Führer', () => {
    const plan = baueFunkplan(
      quellen({
        fahrzeuge: daten([fahrzeug(100), fahrzeug(101)]),
        personal: daten([
          person(1, { fahrzeug_id: 100, staerke_position: 'fuehrer', name: 'Clara Führerin' }),
          person(2, { fahrzeug_id: 100, staerke_position: 'mannschaft', name: 'Dirk Mann' }),
          person(3, { staerke_position: 'fuehrer', name: 'Ohne Fahrzeug' }),
        ]),
      }),
    );
    const fz = plan[0].children!;
    expect(fz[0].leitung).toEqual({ art: 'name', namen: ['Clara Führerin'] });
    expect(fz[1].leitung).toEqual({ art: 'leer' });
  });

  it('sagt beim Fahrzeug den Zustand der Personalliste statt „kein Führer“', () => {
    const plan = baueFunkplan(
      quellen({ fahrzeuge: daten([fahrzeug(100)]), personal: { zustand: 'gesperrt', daten: [] } }),
    );
    expect(plan[0].children![0].leitung).toEqual({ art: 'zustand', zustand: 'gesperrt' });
  });

  it('vergibt über alle Ebenen eindeutige Schlüssel, auch bei gleicher Datenbank-ID', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: daten([abschnitt(7)]),
        einheiten: daten([einheit(7, { abschnitt_id: 7 })]),
        fahrzeuge: daten([fahrzeug(7, { einheit_id: 7 })]),
      }),
    );
    const schluessel = alleSchluessel(plan);
    expect(new Set(schluessel).size).toBe(schluessel.length);
  });
});

describe('aufklappbareSchluessel', () => {
  it('nennt jeden Knoten mit Kindern, auch tief', () => {
    const plan = baueFunkplan(
      quellen({
        abschnitte: daten([abschnitt(1), abschnitt(2)]),
        einheiten: daten([einheit(10, { abschnitt_id: 1 })]),
        fahrzeuge: daten([fahrzeug(100, { einheit_id: 10 })]),
      }),
    );
    expect(aufklappbareSchluessel(plan)).toEqual(['ab-1', 'eh-10']);
  });
});

describe('rendereFunkplanMarkdown', () => {
  const q = quellen({
    abschnitte: daten([
      abschnitt(1, {
        name: 'Abschnitt Nord',
        kurzbezeichnung: 'EA-N',
        leiter_name: 'Anna Leiter',
        kommunikationsmittel: 'digitalfunk',
        erreichbarkeit: '0171 GEHEIM',
        sprechgruppen: [sg(1, 'TMO', '311'), sg(2, 'DMO', '505')],
      }),
      abschnitt(2, { name: 'Abschnitt Süd' }),
    ]),
    einheiten: daten([
      einheit(10, {
        name: '1. Zug',
        abschnitt_id: 1,
        funkrufname: 'Zug 1',
        erreichbarkeit: '0160 GEHEIM',
      }),
    ]),
    fahrzeuge: daten([
      fahrzeug(100, {
        einheit_id: 10,
        funkrufname: 'Florian 1/42-1',
        opta: 'OPTA-1',
        fahrzeugtyp: 'HLF 20',
      }),
    ]),
    personal: { zustand: 'gesperrt', daten: [] },
    sprechgruppen: daten([sg(9, 'DMO', 'DMO 999', true)]),
  });
  const md = rendereFunkplanMarkdown(baueFunkplan(q), '301200Sep26', funkplanLuecken(q), q);

  it('trägt Überschrift und Stand', () => {
    expect(md.startsWith('# Funkplan\n')).toBe(true);
    expect(md).toContain('**Stand:** 301200Sep26');
  });

  it('gibt den Baum eingerückt mit allen Funkangaben wieder', () => {
    expect(md).toContain(
      '- **Abschnitt Nord** · Rufname EA-N · Leitung Anna Leiter · TMO 311 · DMO 505 · Digitalfunk',
    );
    expect(md).toContain('  - **1. Zug** · Rufname Zug 1');
    expect(md).toContain(
      '    - **Florian 1/42-1** (HLF 20) · OPTA OPTA-1 · Führer nicht freigegeben',
    );
  });

  it('nennt die Lücken mit Zahl und Namen und die fehlende Gegenstelle', () => {
    expect(md).toContain('## Lücken');
    expect(md).toContain('- Abschnitte ohne Sprechgruppe: 1 (Abschnitt Süd)');
    expect(md).toContain('- Einheiten ohne Sprechgruppe: 1 (1. Zug)');
    expect(md).toContain('- Einheiten ohne Erreichbarkeit: 0');
    expect(md).toContain('- Einsatzlokale Sprechgruppen ohne Zuordnung: 1 (DMO 999)');
    expect(md).toContain('- Eigene Gegenstelle (Führungsstelle): nicht erfasst');
  });

  it('nennt Verbindungen ohne gemeinsame Sprechgruppe nach den Erreichbarkeiten (LFH-625)', () => {
    expect(md).toContain('- Verbindungen ohne gemeinsame Sprechgruppe: 0');
    expect(md.indexOf('- Verbindungen ohne gemeinsame Sprechgruppe')).toBeGreaterThan(
      md.indexOf('- Einheiten ohne Erreichbarkeit'),
    );
    expect(md.indexOf('- Verbindungen ohne gemeinsame Sprechgruppe')).toBeLessThan(
      md.indexOf('- Einsatzlokale Sprechgruppen ohne Zuordnung'),
    );
    const q4 = quellen({
      abschnitte: daten([
        abschnitt(1, { name: 'EA_Nord', sprechgruppen: [sg(1, 'TMO', 'TMO 311')] }),
      ]),
      einheiten: daten([
        einheit(10, {
          name: '1. Zug',
          abschnitt_id: 1,
          sprechgruppen: [sg(2, 'DMO', 'DMO 505')],
        }),
      ]),
    });
    expect(funkplanLuecken(q4).verbindungenOhneGemeinsameSprechgruppe.treffer).toHaveLength(1);
    expect(rendereFunkplanMarkdown(baueFunkplan(q4), 'X', funkplanLuecken(q4), q4)).toContain(
      '- Verbindungen ohne gemeinsame Sprechgruppe: 1 (1. Zug → EA\\_Nord)',
    );
  });

  it('schreibt „—“ mit Grund statt einer Zahl, wenn eine Quelle fehlt', () => {
    const ohne = quellen({ einheiten: { zustand: 'gesperrt', daten: [] } });
    const text = rendereFunkplanMarkdown(baueFunkplan(ohne), 'X', funkplanLuecken(ohne), ohne);
    expect(text).toContain('- Einheiten ohne Sprechgruppe: — (nicht freigegeben)');
    expect(text).toContain('- Einsatzlokale Sprechgruppen ohne Zuordnung: — (nicht freigegeben)');
    expect(text).toContain('- Verbindungen ohne gemeinsame Sprechgruppe: — (nicht freigegeben)');
  });

  it('nimmt die Erreichbarkeit nie mit (personenbezogen)', () => {
    expect(md).not.toContain('GEHEIM');
    // Die Lückenzeile „Einheiten ohne Erreichbarkeit“ ist erlaubt, die Gliederung kennt keine.
    expect(md.slice(md.indexOf('## Gliederung'))).not.toMatch(/Erreichbar/);
  });

  it('kommt ohne Piktogramme aus', () => {
    expect(md).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('nennt fehlende Quellen im Bericht, statt sie zu verschweigen', () => {
    const ohneFahrzeuge = quellen({
      abschnitte: daten([abschnitt(1)]),
      fahrzeuge: { zustand: 'gesperrt', daten: [] },
      personal: { zustand: 'fehler', daten: [] },
    });
    const text = rendereFunkplanMarkdown(
      baueFunkplan(ohneFahrzeuge),
      'X',
      funkplanLuecken(ohneFahrzeuge),
      ohneFahrzeuge,
    );
    expect(text).toContain('## Quellen');
    expect(text).toContain('- Fahrzeuge: nicht freigegeben — diese Angaben fehlen');
    expect(text).toContain('- Personal (Fahrzeugführer): nicht geladen — diese Angaben fehlen');
    // Mit allen Quellen gibt es den Abschnitt nicht.
    const voll = quellen({ abschnitte: daten([abschnitt(1)]) });
    expect(
      rendereFunkplanMarkdown(baueFunkplan(voll), 'X', funkplanLuecken(voll), voll),
    ).not.toContain('## Quellen');
  });

  it('behauptet „keine Kräfte erfasst“ nur, wenn alle drei Strukturquellen geladen sind', () => {
    const gesperrt = quellen({
      abschnitte: { zustand: 'gesperrt', daten: [] },
      einheiten: { zustand: 'gesperrt', daten: [] },
      fahrzeuge: { zustand: 'gesperrt', daten: [] },
    });
    const text = rendereFunkplanMarkdown(
      baueFunkplan(gesperrt),
      'X',
      funkplanLuecken(gesperrt),
      gesperrt,
    );
    expect(text).not.toContain('keine Kräfte erfasst');
    expect(text).toContain('_(keine Zeilen: Quellen fehlen, siehe oben)_');
    const leer = quellen();
    expect(rendereFunkplanMarkdown([], 'X', funkplanLuecken(leer), leer)).toContain(
      '_(keine Kräfte erfasst)_',
    );
  });

  it('entschärft Markdown-Zeichen in Namen', () => {
    const q2 = quellen({
      abschnitte: daten([abschnitt(1, { name: 'A*B_C', sprechgruppen: [sg(1, 'TMO', '1')] })]),
    });
    expect(rendereFunkplanMarkdown(baueFunkplan(q2), 'X', funkplanLuecken(q2), q2)).toContain(
      '**A\\*B\\_C**',
    );
  });

  it('Rundlauf durch den Renderer: Sonderzeichen in allen Feldern bleiben Text (auch ~)', () => {
    const roh = {
      abschnitt: 'A*B_C [x] \\ `code` ~1~',
      leiter: 'Meier~Schulz',
      einheit: 'Zug ~2~ [Reserve]',
      sg: 'TMO 412_F_DRK',
      typ: 'HLF ~20~',
    };
    const q3 = quellen({
      abschnitte: daten([
        abschnitt(1, {
          name: roh.abschnitt,
          leiter_name: roh.leiter,
          sprechgruppen: [sg(1, 'TMO', roh.sg)],
        }),
      ]),
      einheiten: daten([einheit(10, { name: roh.einheit, abschnitt_id: 1 })]),
      fahrzeuge: daten([fahrzeug(100, { einheit_id: 10, fahrzeugtyp: roh.typ })]),
    });
    const text = rendereFunkplanMarkdown(baueFunkplan(q3), 'X', funkplanLuecken(q3), q3);
    const { container } = render(<Markdown unterEbene={2}>{text}</Markdown>);
    for (const wert of Object.values(roh)) {
      expect(container.textContent, wert).toContain(wert);
    }
    expect(container.querySelectorAll('del, em, a, code')).toHaveLength(0);
  });

  it('Rundlauf: GFM-Autolinks in Namen bleiben Text, ohne <a> (LFH-868)', () => {
    const q4 = quellen({
      abschnitte: daten([
        abschnitt(1, {
          name: AUTOLINKS.www,
          leiter_name: AUTOLINKS.mail,
          sprechgruppen: [sg(1, 'TMO', AUTOLINKS.http)],
        }),
      ]),
      einheiten: daten([einheit(10, { name: AUTOLINKS.spitz, abschnitt_id: 1 })]),
      fahrzeuge: daten([fahrzeug(100, { einheit_id: 10, fahrzeugtyp: AUTOLINKS.gross })]),
    });
    const text = rendereFunkplanMarkdown(baueFunkplan(q4), 'X', funkplanLuecken(q4), q4);
    const { container } = render(<Markdown unterEbene={2}>{text}</Markdown>);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    for (const wert of Object.values(AUTOLINKS)) {
      expect(sichtbar(container.textContent), wert).toContain(wert);
    }
  });
});

describe('md (LFH-868)', () => {
  it('bricht GFM-Autolinks, ohne den sichtbaren Text zu ändern', () => {
    for (const wert of Object.values(AUTOLINKS)) {
      const { container } = render(<Markdown unterEbene={2}>{md(wert)}</Markdown>);
      expect(container.querySelector('a'), wert).toBeNull();
      expect(sichtbar(container.textContent), wert).toBe(wert);
    }
  });

  it('lässt Text ohne Autolink unverändert', () => {
    expect(md('OV Nord, Zug 2 @ Halle 3. www-Team')).toBe('OV Nord, Zug 2 @ Halle 3. www-Team');
  });
});

// ── Eigene Führungsstelle (LFH-849 D4) ─────────────────────────────────────────────────────────

describe('fuehrungsstelleErfasst', () => {
  it('ist ohne Daten und mit leeren Angaben nicht erfasst', () => {
    expect(fuehrungsstelleErfasst(null)).toBe(false);
    expect(fuehrungsstelleErfasst({ sprechgruppen: [] })).toBe(false);
    expect(fuehrungsstelleErfasst({ sprechgruppen: [], rufname: '  ', erreichbarkeit: null })).toBe(
      false,
    );
  });

  it.each<[string, Fuehrungsstelle]>([
    ['Rufname', { sprechgruppen: [], rufname: 'Florian Stadt 10/1' }],
    ['Kommunikationsmittel', { sprechgruppen: [], kommunikationsmittel: 'digitalfunk' }],
    ['Erreichbarkeit', { sprechgruppen: [], erreichbarkeit: '0171 1234567' }],
    ['Sprechgruppe', { sprechgruppen: [sg(1, 'TMO', '311')] }],
  ])('ist mit %s allein erfasst', (_, daten) => {
    expect(fuehrungsstelleErfasst(daten)).toBe(true);
  });
});

describe('baueFunkplan · eigene Führungsstelle', () => {
  const mitFs = quellen({
    abschnitte: daten([abschnitt(1, { name: 'Abschnitt Nord' })]),
    fuehrungsstelle: fs({
      rufname: 'Florian Stadt 10/1',
      sprechgruppen: [sg(1, 'TMO', '311'), sg(2, 'DMO', '505')],
      kommunikationsmittel: 'digitalfunk',
      erreichbarkeit: '0171 GEHEIM',
    }),
  });

  it('hat ohne erfasste Führungsstelle keine Zeile', () => {
    for (const fuehrungsstelle of [
      fs(),
      { zustand: 'laden', daten: null },
      { zustand: 'gesperrt', daten: null },
    ] as const) {
      const zeilen = baueFunkplan(quellen({ abschnitte: daten([abschnitt(1)]), fuehrungsstelle }));
      expect(alleSchluessel(zeilen)).toEqual(['ab-1']);
    }
  });

  it('steht erfasst als erste Zeile, ohne Kinder und ohne Leitung', () => {
    const zeilen = baueFunkplan(mitFs);
    expect(zeilen.map((z) => z.key)).toEqual(['fs', 'ab-1']);
    expect(zeilen[0]).toEqual({
      key: 'fs',
      art: 'fuehrungsstelle',
      id: null,
      stelle: 'Führungsstelle',
      stelleZusatz: null,
      rufname: 'Florian Stadt 10/1',
      leitung: { art: 'leer' },
      tmo: ['311'],
      dmo: ['505'],
      kommunikationsmittel: 'Digitalfunk',
      erreichbarkeit: '0171 GEHEIM',
    });
    expect(aufklappbareSchluessel(zeilen)).toEqual([]);
  });

  it('beginnt die Gliederung im Bericht mit der Führungsstelle, ohne ihre Erreichbarkeit', () => {
    const text = rendereFunkplanMarkdown(baueFunkplan(mitFs), 'X', funkplanLuecken(mitFs), mitFs);
    const gliederung = text.slice(text.indexOf('## Gliederung')).split('\n');
    expect(gliederung[2]).toBe(
      '- **Führungsstelle** · Rufname Florian Stadt 10/1 · TMO 311 · DMO 505 · Digitalfunk',
    );
    expect(gliederung[3]).toBe('- **Abschnitt Nord**');
    expect(text).not.toContain('GEHEIM');
  });

  it('nennt die eigene Gegenstelle nur, solange sie nicht erfasst ist oder nicht vorliegt', () => {
    expect(gegenstelleHinweis(mitFs)).toBeNull();
    expect(gegenstelleHinweis(quellen())).toBe('nicht erfasst');
    expect(
      gegenstelleHinweis(quellen({ fuehrungsstelle: { zustand: 'gesperrt', daten: null } })),
    ).toBe('nicht freigegeben');
    expect(
      gegenstelleHinweis(quellen({ fuehrungsstelle: { zustand: 'fehler', daten: null } })),
    ).toBe('nicht geladen');

    const bericht = (q: FunkplanQuellen) =>
      rendereFunkplanMarkdown(baueFunkplan(q), 'X', funkplanLuecken(q), q);
    expect(bericht(mitFs)).not.toContain('Eigene Gegenstelle');
    expect(bericht(quellen())).toContain('- Eigene Gegenstelle (Führungsstelle): nicht erfasst');
    expect(bericht(quellen({ fuehrungsstelle: { zustand: 'fehler', daten: null } }))).toContain(
      '- Eigene Gegenstelle (Führungsstelle): — (nicht geladen)',
    );
  });

  it('zählt die Verbindung Führungsstelle → oberster Abschnitt in den Lücken', () => {
    const q = quellen({
      abschnitte: daten([
        abschnitt(1, { name: 'Abschnitt Nord', sprechgruppen: [sg(3, 'TMO', '312')] }),
      ]),
      fuehrungsstelle: fs({ sprechgruppen: [sg(1, 'TMO', '311')] }),
    });
    expect(rendereFunkplanMarkdown(baueFunkplan(q), 'X', funkplanLuecken(q), q)).toContain(
      '- Verbindungen ohne gemeinsame Sprechgruppe: 1 (Abschnitt Nord → Führungsstelle)',
    );
  });
});
