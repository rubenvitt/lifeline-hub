import { describe, expect, it } from 'vitest';
import type {
  Einheit,
  Einsatzabschnitt,
  Fernmeldeskizze,
  KommunikationsStelle,
  Sprechgruppe,
} from '../api/types';
import type { FunkplanQuellen } from './funkplan';
import type { Quelle, SkizzenQuelle } from './luecken';
import {
  HERKUNFT_LABEL,
  type FehlendeStruktur,
  type SprechgruppenTeilnehmer,
  baueSprechgruppenplan,
  fehlendText,
  sprechgruppenplanLeerText,
  type SprechgruppenZeile,
} from './sprechgruppenplan';

function sg(
  id: number,
  betriebsart: 'TMO' | 'DMO',
  bezeichnung: string,
  p: Partial<Sprechgruppe> = {},
): Sprechgruppe {
  return { id, bezeichnung, betriebsart, aktiv: true, einsatz_lokal: false, sortier: 0, ...p };
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

const daten = <T>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });
const ohne = <T>(zustand: 'gesperrt' | 'fehler' | 'laden'): Quelle<T> => ({ zustand, daten: [] });

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

const TMO311 = sg(1, 'TMO', 'TMO 311', { hinweis: 'Führungskanal EA Nord', sortier: 2 });
const TMO312 = sg(2, 'TMO', 'TMO 312', { sortier: 1 });
const DMO505 = sg(3, 'DMO', 'DMO 505', { sortier: 1 });
const DMO999 = sg(9, 'DMO', 'DMO 999', { einsatz_lokal: true, einsatz_id: 1, sortier: 0 });
/** Katalog, aber nirgends zugeordnet. */
const TMO400 = sg(4, 'TMO', 'TMO 400', { sortier: 0 });

const EA_NORD = abschnitt(1, { name: 'EA Nord', kurzbezeichnung: 'EA N', sprechgruppen: [TMO311] });
const ZUG = einheit(10, {
  name: '1. Zug',
  funkrufname: 'Florian Musterstadt 1',
  abschnitt_id: 1,
  sprechgruppen: [TMO311, DMO505],
});

const zeile = (zeilen: SprechgruppenZeile[], bezeichnung: string) => {
  const z = zeilen.find((x) => x.bezeichnung === bezeichnung);
  if (!z) throw new Error(`keine Zeile ${bezeichnung}`);
  return z;
};

describe('baueSprechgruppenplan — Menge', () => {
  it('nimmt zugeordnete und einsatzlokale Sprechgruppen, einen Katalogeintrag ohne Zuordnung nicht', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({
        abschnitte: daten([EA_NORD]),
        einheiten: daten([ZUG]),
        sprechgruppen: daten([TMO400, TMO311, DMO505, DMO999]),
      }),
      1,
    );
    expect(zeilen.map((z) => z.bezeichnung).sort()).toEqual(['DMO 505', 'DMO 999', 'TMO 311']);
  });

  it('führt eine Sprechgruppe an Abschnitt, Einheit und Liste genau einmal (nach id)', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({
        abschnitte: daten([EA_NORD]),
        einheiten: daten([ZUG]),
        sprechgruppen: daten([TMO311]),
      }),
      1,
    );
    expect(zeilen.filter((z) => z.id === TMO311.id)).toHaveLength(1);
    expect(zeilen.map((z) => z.key)).toEqual(['sg-1', 'sg-3']);
  });

  it('unterscheidet gleichnamige Sprechgruppen aus Katalog und Einsatz (Vergleich über id)', () => {
    const lokal311 = sg(21, 'TMO', 'TMO 311', { einsatz_lokal: true, sortier: 2 });
    const zeilen = baueSprechgruppenplan(
      quellen({
        abschnitte: daten([EA_NORD]),
        sprechgruppen: daten([lokal311]),
      }),
      1,
    );
    expect(zeilen.map((z) => [z.id, z.herkunft])).toEqual([
      [1, 'katalog'],
      [21, 'einsatzlokal'],
    ]);
  });

  it('ordnet TMO vor DMO, sonst nach Sortierwert und Bezeichnung', () => {
    const a = sg(30, 'DMO', 'DMO B', { sortier: 1 });
    const b = sg(31, 'DMO', 'DMO A', { sortier: 1 });
    const zeilen = baueSprechgruppenplan(
      quellen({
        abschnitte: daten([abschnitt(1, { sprechgruppen: [DMO505, a, b, TMO311, TMO312] })]),
        sprechgruppen: daten([DMO999]),
      }),
      1,
    );
    expect(zeilen.map((z) => z.bezeichnung)).toEqual([
      'TMO 312',
      'TMO 311',
      'DMO 999',
      'DMO 505',
      'DMO A',
      'DMO B',
    ]);
  });

  it('trägt Betriebsart, Hinweis und Herkunft der Sprechgruppe', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({ abschnitte: daten([EA_NORD]), sprechgruppen: daten([DMO999]) }),
      1,
    );
    expect(zeile(zeilen, 'TMO 311')).toMatchObject({
      betriebsart: 'TMO',
      hinweis: 'Führungskanal EA Nord',
      herkunft: 'katalog',
    });
    expect(zeile(zeilen, 'DMO 999')).toMatchObject({
      betriebsart: 'DMO',
      hinweis: null,
      herkunft: 'einsatzlokal',
    });
    expect(HERKUNFT_LABEL).toEqual({ katalog: 'Katalog', einsatzlokal: 'einsatzlokal' });
  });

  it('macht aus einem leeren Hinweis keinen Hinweis', () => {
    const leer = sg(5, 'TMO', 'TMO 500', { hinweis: '   ' });
    const zeilen = baueSprechgruppenplan(
      quellen({ abschnitte: daten([abschnitt(1, { sprechgruppen: [leer] })]) }),
      1,
    );
    expect(zeile(zeilen, 'TMO 500').hinweis).toBeNull();
  });
});

describe('baueSprechgruppenplan — Teilnehmer', () => {
  it('nennt Abschnitt und Einheit mit Rufnamen und Ziel (Spec: „Teilnehmer einer Sprechgruppe“)', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({ abschnitte: daten([EA_NORD]), einheiten: daten([ZUG]) }),
      7,
    );
    expect(zeile(zeilen, 'TMO 311').teilnehmer).toEqual({
      art: 'vollstaendig',
      teilnehmer: [
        {
          art: 'abschnitt',
          key: 'ab-1',
          id: 1,
          name: 'EA Nord',
          rufname: 'EA N',
          ziel: '/einsaetze/7/einsatzabschnitte?abschnitt=1',
        },
        {
          art: 'einheit',
          key: 'eh-10',
          id: 10,
          name: '1. Zug',
          rufname: 'Florian Musterstadt 1',
          ziel: '/einsaetze/7/einheiten/10',
        },
      ],
    });
  });

  it('rät keinen Rufnamen', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({ abschnitte: daten([abschnitt(2, { sprechgruppen: [TMO312] })]) }),
      1,
    );
    const t = zeile(zeilen, 'TMO 312').teilnehmer;
    expect(t.art === 'vollstaendig' && t.teilnehmer[0].rufname).toBeNull();
  });

  it('stellt eine einsatzlokale Sprechgruppe ohne Zuordnung mit „keine“ Teilnehmer dar', () => {
    const zeilen = baueSprechgruppenplan(quellen({ sprechgruppen: daten([DMO999]) }), 1);
    expect(zeile(zeilen, 'DMO 999')).toMatchObject({
      herkunft: 'einsatzlokal',
      teilnehmer: { art: 'vollstaendig', teilnehmer: [] },
    });
  });
});

describe('baueSprechgruppenplan — fehlende Strukturquelle', () => {
  it('Einheiten gesperrt: Abschnitts-Sprechgruppen „unvollständig“, lokale ohne Abschnitt „unbekannt“', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({
        abschnitte: daten([EA_NORD]),
        einheiten: ohne('gesperrt'),
        sprechgruppen: daten([DMO999]),
      }),
      1,
    );
    // Die nur an Einheiten hängende DMO 505 ist nicht erkennbar und fehlt.
    expect(zeilen.map((z) => z.bezeichnung)).toEqual(['TMO 311', 'DMO 999']);
    const fehlend = [{ quelle: 'einheiten', name: 'Einheiten', zustand: 'gesperrt' }];
    expect(zeile(zeilen, 'TMO 311').teilnehmer).toMatchObject({
      art: 'unvollstaendig',
      teilnehmer: [{ key: 'ab-1' }],
      fehlend,
    });
    // Keine Zeile behauptet „keine Teilnehmer“, wenn eine gesperrte Quelle sie tragen könnte.
    expect(zeile(zeilen, 'DMO 999').teilnehmer).toEqual({ art: 'unbekannt', fehlend });
  });

  it('Abschnitte lädt, Einheiten geladen: die Einheit steht, der Abschnitt fehlt mit Grund', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({ abschnitte: ohne('laden'), einheiten: daten([ZUG]) }),
      1,
    );
    expect(zeile(zeilen, 'DMO 505').teilnehmer).toEqual({
      art: 'unvollstaendig',
      teilnehmer: [expect.objectContaining({ key: 'eh-10' })],
      fehlend: [{ quelle: 'abschnitte', name: 'Abschnitte', zustand: 'laden' }],
    });
  });

  it('beide Strukturquellen fehlen: nur einsatzlokale, alle „unbekannt“ mit beiden Gründen', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({
        abschnitte: ohne('gesperrt'),
        einheiten: ohne('fehler'),
        sprechgruppen: daten([TMO400, DMO999]),
      }),
      1,
    );
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0].teilnehmer).toEqual({
      art: 'unbekannt',
      fehlend: [
        { quelle: 'abschnitte', name: 'Abschnitte', zustand: 'gesperrt' },
        { quelle: 'einheiten', name: 'Einheiten', zustand: 'fehler' },
      ],
    });
  });

  it('ohne Sprechgruppenliste bleiben die zugeordneten, nur lokale ohne Zuordnung fehlen', () => {
    const zeilen = baueSprechgruppenplan(
      quellen({
        abschnitte: daten([EA_NORD]),
        einheiten: daten([ZUG]),
        sprechgruppen: ohne('fehler'),
      }),
      1,
    );
    expect(zeilen.map((z) => z.bezeichnung)).toEqual(['TMO 311', 'DMO 505']);
    expect(zeile(zeilen, 'TMO 311').teilnehmer.art).toBe('vollstaendig');
  });
});

describe('fehlendText und Leertext', () => {
  it('nennt jede fehlende Quelle mit ihrem Grund', () => {
    expect(
      fehlendText([
        { quelle: 'abschnitte', name: 'Abschnitte', zustand: 'gesperrt' },
        { quelle: 'einheiten', name: 'Einheiten', zustand: 'fehler' },
      ]),
    ).toBe('Abschnitte nicht freigegeben, Einheiten nicht geladen');
  });

  it('behauptet „keine Sprechgruppe“ nur mit allen drei Quellen', () => {
    expect(sprechgruppenplanLeerText(quellen())).toBe(
      'Keine Sprechgruppe im Einsatz zugeordnet oder angelegt',
    );
    expect(sprechgruppenplanLeerText(quellen({ einheiten: ohne('gesperrt') }))).toBe(
      'Keine Zeilen darstellbar — Einheiten: nicht freigegeben',
    );
    expect(
      sprechgruppenplanLeerText(
        quellen({ abschnitte: ohne('gesperrt'), sprechgruppen: ohne('fehler') }),
      ),
    ).toBe(
      'Keine Zeilen darstellbar — Abschnitte: nicht freigegeben · Sprechgruppen: nicht geladen',
    );
  });
});

// ── LFH-893: externe Stellen und Komponenten als Teilnehmer ───────────────────────────────────

describe('baueSprechgruppenplan — externe Stellen und Komponenten (LFH-893)', () => {
  const SL_AS = sg(31, 'TMO', 'TMO SL AS', { sortier: 3 });
  const ILS: KommunikationsStelle = {
    id: 5,
    stellenart: 'leitstelle',
    bezeichnung: 'ILS Musterhausen',
    verbindungen: [],
    sprechgruppen: [{ sprechgruppe: SL_AS, status: 'geplant' }],
  };
  const S2: KommunikationsStelle = {
    id: 6,
    stellenart: 'funktion',
    funktion: 's2',
    verbindungen: [],
    sprechgruppen: [{ sprechgruppe: TMO311, status: 'bestehend' }],
  };
  const skizze = (komponenten: Fernmeldeskizze['komponenten']): SkizzenQuelle => ({
    zustand: 'daten',
    daten: {
      lage: [],
      komponenten,
      verbindungen: [],
      bereiche: [],
      schriftfeld: {
        herausgeber: null,
        vs_vermerk: 'keiner',
        gueltig_ab: null,
        gez_name: null,
        gez_at: null,
      },
      stand: null,
    },
  });

  it('nennt die Leitstelle mit Status als Teilnehmer, mit Ziel Kommunikationsplan', () => {
    const zeilen = baueSprechgruppenplan(quellen({ abschnitte: daten([EA_NORD]) }), 1, {
      stellen: daten([ILS, S2]),
      skizze: skizze([]),
    });
    const z = zeile(zeilen, 'TMO SL AS');
    expect(z.teilnehmer).toEqual({
      art: 'vollstaendig',
      teilnehmer: [
        {
          art: 'extern',
          key: 'ks-5',
          id: 5,
          name: 'ILS Musterhausen',
          rufname: null,
          ziel: '/einsaetze/1/stab/kommunikationsplan',
          status: 'geplant',
        },
      ],
    });
    // Eine Führungsfunktion ist nie Teilnehmer.
    expect(
      (zeile(zeilen, 'TMO 311').teilnehmer as { teilnehmer: { key: string }[] }).teilnehmer.map(
        (t) => t.key,
      ),
    ).toEqual(['ab-1']);
  });

  it('nennt eine Komponente als Teilnehmer, ohne Ziel', () => {
    const zeilen = baueSprechgruppenplan(quellen(), 1, {
      stellen: daten([]),
      skizze: skizze([{ id: 2, art: 'repeater', bezeichnung: null, sprechgruppen: [DMO505] }]),
    });
    const z = zeile(zeilen, 'DMO 505');
    expect(z.teilnehmer.art).toBe('vollstaendig');
    const [t] = (z.teilnehmer as { teilnehmer: SprechgruppenTeilnehmer[] }).teilnehmer;
    expect(t).toMatchObject({ art: 'komponente', key: 'ko-2', ziel: null, status: 'bestehend' });
    expect(t.name).toBe('Repeater');
  });

  it('sagt „unvollständig“, wenn die externen Stellen nicht geladen sind', () => {
    const zeilen = baueSprechgruppenplan(quellen({ abschnitte: daten([EA_NORD]) }), 1, {
      stellen: ohne('fehler'),
      skizze: skizze([]),
    });
    const z = zeile(zeilen, 'TMO 311');
    expect(z.teilnehmer.art).toBe('unvollstaendig');
    expect(fehlendText((z.teilnehmer as { fehlend: FehlendeStruktur[] }).fehlend)).toBe(
      'Externe Stellen nicht geladen',
    );
  });
});
