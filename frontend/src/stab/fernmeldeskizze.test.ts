import { describe, expect, it } from 'vitest';
import type { Einheit, Einsatzabschnitt, Sprechgruppe } from '../api/types';
import {
  baueFuehrungsorganisation,
  type OrgKnoten,
} from '../pages/einsatzabschnitte/fuehrungsorganisation';
import { baueFernmeldeskizze, type SkizzenKnoten } from './fernmeldeskizze';
import { baueFunkplan, type FunkplanZeile } from './funkplan';
import { verbindungenOhneGemeinsameSprechgruppe, type Quelle } from './luecken';

function sg(id: number, betriebsart: 'TMO' | 'DMO', bezeichnung: string): Sprechgruppe {
  return { id, bezeichnung, betriebsart, aktiv: true, einsatz_lokal: false, sortier: id };
}
const TMO311 = sg(1, 'TMO', 'TMO 311');
const TMO312 = sg(2, 'TMO', 'TMO 312');
const DMO505 = sg(3, 'DMO', 'DMO 505');
const DMO506 = sg(4, 'DMO', 'DMO 506');

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

const daten = <T>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });

/**
 * Ein Datensatz mit allen Platzierungsfällen: Unterabschnitt, oberste Einheit, Untereinheit,
 * Waisen (Abschnitt und Einheit mit unbekannter übergeordneter Stelle), Sammelknoten, und
 * Verbindungen jeder Art (gemeinsam, keine, ohne Urteil).
 */
const ABSCHNITTE = [
  abschnitt(1, {
    name: 'EA Nord',
    kurzbezeichnung: 'EA-N',
    kommunikationsmittel: 'digitalfunk',
    sprechgruppen: [TMO311, DMO505],
  }),
  abschnitt(2, { name: 'UA Deich', ueber_abschnitt_id: 1, sprechgruppen: [TMO312] }),
  abschnitt(3, { name: 'UA Damm', ueber_abschnitt_id: 1 }),
  abschnitt(4, { name: 'Waise', ueber_abschnitt_id: 99, sprechgruppen: [DMO506] }),
];
const EINHEITEN = [
  einheit(10, {
    name: '1. Zug',
    abschnitt_id: 1,
    funkrufname: 'Florian 1/10',
    sprechgruppen: [DMO505],
  }),
  einheit(11, { name: 'Gruppe 1', abschnitt_id: 1, ueber_einheit_id: 10, sprechgruppen: [DMO506] }),
  einheit(12, { name: '2. Zug', abschnitt_id: 2, sprechgruppen: [TMO311] }),
  einheit(13, {
    name: 'Gruppe Waise',
    abschnitt_id: 1,
    ueber_einheit_id: 777,
    sprechgruppen: [TMO311],
  }),
  einheit(20, { name: 'Lose', sprechgruppen: [TMO312] }),
];

type Struktur = { key: string; kinder: Struktur[] };
const struktur = (k: readonly (OrgKnoten | SkizzenKnoten)[]): Struktur[] =>
  k.map((x) => ({ key: x.key, kinder: struktur(x.kinder) }));

function alle(k: readonly SkizzenKnoten[]): SkizzenKnoten[] {
  return k.flatMap((x) => [x, ...alle(x.kinder)]);
}
function alleZeilen(z: readonly FunkplanZeile[]): FunkplanZeile[] {
  return z.flatMap((x) => [x, ...alleZeilen(x.children ?? [])]);
}
function knoten(k: readonly SkizzenKnoten[], key: string) {
  const t = alle(k).find((x) => x.key === key);
  if (!t || t.art === 'sammel') throw new Error(`kein Knoten ${key}`);
  return t;
}

describe('baueFernmeldeskizze — Struktur', () => {
  it('hat denselben Baum wie das Organigramm', () => {
    const skizze = baueFernmeldeskizze(ABSCHNITTE, EINHEITEN);
    const org = baueFuehrungsorganisation(ABSCHNITTE, EINHEITEN);
    expect(struktur(skizze.wurzeln)).toEqual(struktur(org.wurzeln));
    expect(skizze.wurzeln[skizze.wurzeln.length - 1]?.key).toBe('sammel');
  });

  it('übersteht einen Ring wie das Organigramm (der Server verhindert ihn, Daten können lügen)', () => {
    const ring = [
      abschnitt(1, { ueber_abschnitt_id: 2, sprechgruppen: [TMO311] }),
      abschnitt(2, { ueber_abschnitt_id: 1, sprechgruppen: [DMO505] }),
    ];
    const skizze = baueFernmeldeskizze(ring, []);
    expect(struktur(skizze.wurzeln)).toEqual(struktur(baueFuehrungsorganisation(ring, []).wurzeln));
  });

  it('zeigt ohne Einheiten nur die Abschnitte und meldet es', () => {
    const skizze = baueFernmeldeskizze(ABSCHNITTE, null);
    expect(skizze.einheitenFehlen).toBe(true);
    expect(alle(skizze.wurzeln).every((k) => k.art === 'abschnitt')).toBe(true);
  });
});

describe('baueFernmeldeskizze — Funkangaben wie die Tabelle', () => {
  it('trägt je Schlüssel Rufname, TMO, DMO und Kommunikationsmittel wie der Funkplan', () => {
    const skizze = alle(baueFernmeldeskizze(ABSCHNITTE, EINHEITEN).wurzeln);
    const zeilen = new Map(
      alleZeilen(
        baueFunkplan({
          abschnitte: daten(ABSCHNITTE),
          einheiten: daten(EINHEITEN),
          fahrzeuge: daten([]),
          personal: daten([]),
          sprechgruppen: daten([]),
        }),
      ).map((z) => [z.key, z]),
    );
    const verglichen = skizze.filter((k) => k.art !== 'sammel');
    expect(verglichen).toHaveLength(ABSCHNITTE.length + EINHEITEN.length);
    for (const k of verglichen) {
      const z = zeilen.get(k.key)!;
      expect(
        { rufname: k.rufname, tmo: k.tmo, dmo: k.dmo, km: k.kommunikationsmittel },
        k.key,
      ).toEqual({ rufname: z.rufname, tmo: z.tmo, dmo: z.dmo, km: z.kommunikationsmittel });
    }
    expect(knoten(skizze, 'ab-1')).toMatchObject({
      name: 'EA Nord',
      rufname: 'EA-N',
      tmo: ['TMO 311'],
      dmo: ['DMO 505'],
      kommunikationsmittel: 'Digitalfunk',
    });
  });
});

describe('baueFernmeldeskizze — Kanten', () => {
  const w = baueFernmeldeskizze(ABSCHNITTE, EINHEITEN).wurzeln;

  it('urteilt nicht an der Wurzel und unter dem Sammelknoten', () => {
    for (const k of w)
      if (k.art !== 'sammel') expect(k.kante, k.key).toEqual({ art: 'ohne-urteil' });
    const sammel = w.find((k) => k.art === 'sammel')!;
    for (const k of sammel.kinder) {
      if (k.art !== 'sammel') expect(k.kante, k.key).toEqual({ art: 'ohne-urteil' });
    }
  });

  it('trägt die gemeinsame Sprechgruppe zur übergeordneten Stelle', () => {
    expect(knoten(w, 'eh-10').kante).toEqual({ art: 'gemeinsam', tmo: [], dmo: ['DMO 505'] });
    expect(knoten(w, 'eh-13').kante).toEqual({ art: 'gemeinsam', tmo: ['TMO 311'], dmo: [] });
  });

  it('urteilt „keine“ ohne gemeinsamen Kanal und nicht bei einer Seite ohne Sprechgruppe', () => {
    expect(knoten(w, 'ab-2').kante).toEqual({ art: 'keine' });
    expect(knoten(w, 'eh-11').kante).toEqual({ art: 'keine' });
    expect(knoten(w, 'eh-12').kante).toEqual({ art: 'keine' });
    expect(knoten(w, 'ab-3').kante).toEqual({ art: 'ohne-urteil' });
  });

  it('zählt so viele Kanten „keine“, wie die Lücke im Funkplan Treffer hat', () => {
    const keine = alle(w).filter((k) => k.art !== 'sammel' && k.kante.art === 'keine');
    const luecke = verbindungenOhneGemeinsameSprechgruppe(daten(ABSCHNITTE), daten(EINHEITEN));
    expect(keine.map((k) => k.key).sort()).toEqual(
      luecke.treffer
        .map((v) => `${v.unten.art === 'abschnitt' ? 'ab' : 'eh'}-${v.unten.id}`)
        .sort(),
    );
    expect(keine).toHaveLength(3);
  });
});
