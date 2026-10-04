import { describe, expect, it } from 'vitest';
import type {
  Einheit,
  Einsatzabschnitt,
  Fuehrungsstelle,
  KommunikationsStelle,
  Sprechgruppe,
} from '../api/types';
import type {
  Fernmeldeskizze,
  KommunikationsStelleMitKanaelen,
  SkizzenVerbindung,
  Verbindungsstatus,
} from '../api/fernmeldeskizzeVertrag';
import type { FuehrungsstelleQuelle } from './fuehrungsstelle';
import {
  abschnitteOhneSprechgruppe,
  kanalbelegung,
  schienenMitEinemTeilnehmer,
  type KanalQuellen,
  type SkizzenQuelle,
  einheitenOhneErreichbarkeit,
  einheitenOhneSprechgruppe,
  leitstelleOhneVerbindung,
  lokaleSprechgruppenOhneZuordnung,
  verbindungenOhneGemeinsameSprechgruppe,
  verbindungsurteil,
  type Quelle,
} from './luecken';

function sg(id: number, bezeichnung: string, lokal = false): Sprechgruppe {
  return {
    id,
    bezeichnung,
    betriebsart: 'TMO',
    aktiv: true,
    einsatz_lokal: lokal,
    einsatz_id: lokal ? 1 : null,
    sortier: id,
  };
}

function abschnitt(id: number, sprechgruppen: Sprechgruppe[] = []): Einsatzabschnitt {
  return { id, einsatz_id: 1, name: `A${id}`, sortier: id, sprechgruppen };
}

function einheit(
  id: number,
  {
    sprechgruppen = [],
    erreichbarkeit = null,
  }: { sprechgruppen?: Sprechgruppe[]; erreichbarkeit?: string | null } = {},
): Einheit {
  return {
    id,
    einsatz_id: 1,
    name: `E${id}`,
    sortier: id,
    sprechgruppen,
    erreichbarkeit,
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    status: { quelle: 'ohne', verteilung: [] },
  } as Einheit;
}

const daten = <T>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });
const gesperrt = <T>(): Quelle<T> => ({ zustand: 'gesperrt', daten: [] });
const laden = <T>(): Quelle<T> => ({ zustand: 'laden', daten: [] });
/** Geladen, aber nichts erfasst: der Stand vor LFH-849. */
const ohneFs: FuehrungsstelleQuelle = { zustand: 'daten', daten: null };
const fs = (
  sprechgruppen: Sprechgruppe[],
  p: Partial<Fuehrungsstelle> = {},
): FuehrungsstelleQuelle => ({
  zustand: 'daten',
  daten: { sprechgruppen, ...p },
});

describe('abschnitteOhneSprechgruppe', () => {
  it('trifft nur Abschnitte ohne zugeordnete Sprechgruppe', () => {
    const l = abschnitteOhneSprechgruppe(daten([abschnitt(1, [sg(1, '311')]), abschnitt(2)]));
    expect(l.zustand).toBe('daten');
    expect(l.treffer.map((a) => a.id)).toEqual([2]);
  });

  it('meldet den Leerfall nur mit geladenen Daten', () => {
    expect(abschnitteOhneSprechgruppe(daten([abschnitt(1, [sg(1, '311')])]))).toEqual({
      zustand: 'daten',
      treffer: [],
    });
  });

  it('behauptet ohne Daten keine Zahl', () => {
    expect(abschnitteOhneSprechgruppe(gesperrt())).toEqual({ zustand: 'gesperrt', treffer: [] });
    expect(abschnitteOhneSprechgruppe(laden())).toEqual({ zustand: 'laden', treffer: [] });
  });
});

describe('einheitenOhneSprechgruppe / einheitenOhneErreichbarkeit', () => {
  it('trifft Einheiten ohne Sprechgruppe', () => {
    const l = einheitenOhneSprechgruppe(
      daten([einheit(1), einheit(2, { sprechgruppen: [sg(1, '311')] })]),
    );
    expect(l.treffer.map((e) => e.id)).toEqual([1]);
  });

  it('zählt eine leere oder nur aus Leerzeichen bestehende Erreichbarkeit als fehlend', () => {
    const l = einheitenOhneErreichbarkeit(
      daten([
        einheit(1, { erreichbarkeit: '0171 1234567' }),
        einheit(2, { erreichbarkeit: '   ' }),
        einheit(3),
      ]),
    );
    expect(l.treffer.map((e) => e.id)).toEqual([2, 3]);
  });

  it('reicht den Zustand der Quelle durch', () => {
    expect(einheitenOhneErreichbarkeit({ zustand: 'fehler', daten: [] }).zustand).toBe('fehler');
  });
});

describe('lokaleSprechgruppenOhneZuordnung', () => {
  const lokalFrei = sg(10, 'DMO 999', true);
  const lokalAmAbschnitt = sg(11, 'TMO 311', true);
  const lokalAnEinheit = sg(12, 'TMO 312', true);
  const katalogFrei = sg(13, 'TMO 400');

  it('trifft nur einsatzlokale Sprechgruppen, die weder Abschnitt noch Einheit tragen', () => {
    const l = lokaleSprechgruppenOhneZuordnung(
      daten([lokalFrei, lokalAmAbschnitt, lokalAnEinheit, katalogFrei]),
      daten([abschnitt(1, [lokalAmAbschnitt])]),
      daten([einheit(1, { sprechgruppen: [lokalAnEinheit] })]),
      ohneFs,
    );
    expect(l.zustand).toBe('daten');
    expect(l.treffer.map((s) => s.bezeichnung)).toEqual(['DMO 999']);
  });

  it('nimmt den schlechtesten Zustand der drei Quellen und behauptet dann keine Zahl', () => {
    const l = lokaleSprechgruppenOhneZuordnung(daten([lokalFrei]), daten([]), gesperrt(), ohneFs);
    expect(l).toEqual({ zustand: 'gesperrt', treffer: [] });
    expect(lokaleSprechgruppenOhneZuordnung(laden(), daten([]), daten([]), ohneFs).zustand).toBe(
      'laden',
    );
  });

  it('zählt eine lokale Sprechgruppe nur an der Führungsstelle nicht als Lücke (LFH-849)', () => {
    const l = lokaleSprechgruppenOhneZuordnung(
      daten([lokalFrei, lokalAmAbschnitt]),
      daten([]),
      daten([]),
      fs([lokalAmAbschnitt]),
    );
    expect(l.treffer.map((s) => s.bezeichnung)).toEqual(['DMO 999']);
  });

  it('behauptet ohne geladene Führungsstelle keine Zahl', () => {
    const l = lokaleSprechgruppenOhneZuordnung(daten([lokalFrei]), daten([]), daten([]), {
      zustand: 'fehler',
      daten: null,
    });
    expect(l).toEqual({ zustand: 'fehler', treffer: [] });
  });
});

// ── Verbindungen (LFH-625 D3) ──────────────────────────────────────────────────────────────────

function sgArt(id: number, bezeichnung: string, betriebsart: 'TMO' | 'DMO'): Sprechgruppe {
  return { ...sg(id, bezeichnung), betriebsart };
}
const TMO311 = sgArt(1, 'TMO 311', 'TMO');
const TMO312 = sgArt(2, 'TMO 312', 'TMO');
const DMO505 = sgArt(3, 'DMO 505', 'DMO');
const DMO506 = sgArt(4, 'DMO 506', 'DMO');

describe('verbindungsurteil', () => {
  it('liefert die gemeinsamen Sprechgruppen getrennt nach Betriebsart', () => {
    expect(verbindungsurteil([TMO311, DMO505, TMO312], [DMO505, TMO311])).toEqual({
      art: 'gemeinsam',
      tmo: ['TMO 311'],
      dmo: ['DMO 505'],
    });
  });

  it('urteilt „keine“, wenn beide Seiten Sprechgruppen haben, aber keine gemeinsame', () => {
    expect(verbindungsurteil([TMO311], [DMO505])).toEqual({ art: 'keine' });
  });

  it('urteilt nicht, wenn einer Seite jede Sprechgruppe fehlt', () => {
    expect(verbindungsurteil([], [DMO505])).toEqual({ art: 'ohne-urteil' });
    expect(verbindungsurteil([TMO311], [])).toEqual({ art: 'ohne-urteil' });
    expect(verbindungsurteil([], [])).toEqual({ art: 'ohne-urteil' });
  });

  it('vergleicht die Sprechgruppe selbst, nicht ihre Bezeichnung', () => {
    const lokal = { ...sgArt(99, 'TMO 311', 'TMO'), einsatz_lokal: true };
    expect(verbindungsurteil([TMO311], [lokal])).toEqual({ art: 'keine' });
  });
});

describe('verbindungenOhneGemeinsameSprechgruppe', () => {
  const ab = (id: number, sprechgruppen: Sprechgruppe[], ueber?: number): Einsatzabschnitt => ({
    ...abschnitt(id, sprechgruppen),
    name: `A${id}`,
    ueber_abschnitt_id: ueber,
  });
  const eh = (
    id: number,
    sprechgruppen: Sprechgruppe[],
    p: { abschnitt_id?: number; ueber_einheit_id?: number } = {},
  ): Einheit => ({ ...einheit(id, { sprechgruppen }), ...p });

  it('prüft Unterabschnitt → Abschnitt, oberste Einheit → Abschnitt, Untereinheit → Einheit', () => {
    const abschnitte = [ab(1, [TMO311]), ab(2, [DMO505], 1)];
    const einheiten = [
      eh(10, [TMO312], { abschnitt_id: 1 }),
      eh(11, [DMO506], { abschnitt_id: 1, ueber_einheit_id: 10 }),
      eh(12, [TMO311], { abschnitt_id: 1 }),
    ];
    const l = verbindungenOhneGemeinsameSprechgruppe(daten(abschnitte), daten(einheiten), ohneFs);
    expect(l.zustand).toBe('daten');
    expect(l.treffer).toEqual([
      {
        unten: { art: 'abschnitt', id: 2, name: 'A2' },
        oben: { art: 'abschnitt', id: 1, name: 'A1' },
      },
      {
        unten: { art: 'einheit', id: 10, name: 'E10' },
        oben: { art: 'abschnitt', id: 1, name: 'A1' },
      },
      {
        unten: { art: 'einheit', id: 11, name: 'E11' },
        oben: { art: 'einheit', id: 10, name: 'E10' },
      },
    ]);
  });

  it('bildet für Waisen kein Paar', () => {
    const abschnitte = [ab(2, [DMO505], 77)];
    const einheiten = [eh(10, [TMO312], { abschnitt_id: 88 }), eh(11, [TMO312])];
    expect(
      verbindungenOhneGemeinsameSprechgruppe(daten(abschnitte), daten(einheiten), ohneFs).treffer,
    ).toEqual([]);
  });

  it('nimmt eine Einheit mit unbekannter übergeordneter Einheit als oberste ihres Abschnitts', () => {
    const abschnitte = [ab(1, [TMO311])];
    const einheiten = [eh(11, [DMO506], { abschnitt_id: 1, ueber_einheit_id: 999 })];
    expect(
      verbindungenOhneGemeinsameSprechgruppe(daten(abschnitte), daten(einheiten), ohneFs).treffer,
    ).toEqual([
      {
        unten: { art: 'einheit', id: 11, name: 'E11' },
        oben: { art: 'abschnitt', id: 1, name: 'A1' },
      },
    ]);
  });

  it('zählt eine Stelle ohne Sprechgruppe nicht, die Lücke steht schon am Knoten', () => {
    const abschnitte = [ab(1, [TMO311]), ab(2, [], 1)];
    const einheiten = [eh(10, [], { abschnitt_id: 1 })];
    expect(
      verbindungenOhneGemeinsameSprechgruppe(daten(abschnitte), daten(einheiten), ohneFs).treffer,
    ).toEqual([]);
  });

  it.each(['gesperrt', 'fehler', 'laden'] as const)(
    'hat ohne Einheiten (%s) keine Zahl, sondern den Zustand',
    (zustand) => {
      const l = verbindungenOhneGemeinsameSprechgruppe(
        daten([ab(1, [TMO311]), ab(2, [DMO505], 1)]),
        {
          zustand,
          daten: [],
        },
        ohneFs,
      );
      expect(l).toEqual({ zustand, treffer: [] });
    },
  );

  it('hat ohne Abschnitte keine Zahl', () => {
    const l = verbindungenOhneGemeinsameSprechgruppe(
      { zustand: 'gesperrt', daten: [] },
      daten([eh(10, [TMO312])]),
      ohneFs,
    );
    expect(l).toEqual({ zustand: 'gesperrt', treffer: [] });
  });

  // ── Führungsstelle → oberste Abschnitte (LFH-849 D5) ──────────────────────────────────────────

  it('prüft jeden obersten Abschnitt gegen die eigene Führungsstelle', () => {
    const abschnitte = [ab(1, [TMO311]), ab(2, [DMO505]), ab(3, [TMO312], 1), ab(4, [DMO506], 77)];
    const l = verbindungenOhneGemeinsameSprechgruppe(
      daten(abschnitte),
      daten([]),
      fs([TMO311, DMO506]),
    );
    expect(l.zustand).toBe('daten');
    // A1 teilt TMO 311, A4 (Waise, steht oben) teilt DMO 506; A3 hängt an A1 und urteilt dort.
    expect(l.treffer).toEqual([
      {
        unten: { art: 'abschnitt', id: 2, name: 'A2' },
        oben: { art: 'fuehrungsstelle', name: 'Führungsstelle' },
      },
      {
        unten: { art: 'abschnitt', id: 3, name: 'A3' },
        oben: { art: 'abschnitt', id: 1, name: 'A1' },
      },
    ]);
  });

  it('zählt nichts gegen eine Führungsstelle ohne Sprechgruppe', () => {
    const l = verbindungenOhneGemeinsameSprechgruppe(
      daten([ab(1, [TMO311])]),
      daten([]),
      fs([], { rufname: 'Florian Stadt 10/1' }),
    );
    expect(l).toEqual({ zustand: 'daten', treffer: [] });
  });

  it.each(['gesperrt', 'fehler', 'laden'] as const)(
    'hat ohne Führungsstelle (%s) keine Zahl, sondern den Zustand',
    (zustand) => {
      const l = verbindungenOhneGemeinsameSprechgruppe(
        daten([ab(1, [TMO311]), ab(2, [DMO505], 1)]),
        daten([]),
        { zustand, daten: null },
      );
      expect(l).toEqual({ zustand, treffer: [] });
    },
  );
});

describe('leitstelleOhneVerbindung (LFH-848)', () => {
  const stelle = (
    id: number,
    stellenart: KommunikationsStelle['stellenart'],
    verbindungen = 0,
  ): KommunikationsStelle => ({
    id,
    stellenart,
    bezeichnung: `Stelle ${id}`,
    sprechgruppen: [],
    verbindungen: Array.from({ length: verbindungen }, (_, i) => ({
      id: id * 10 + i,
      mittel: 'festnetz' as const,
      wert: '0421 1',
    })),
  });
  const daten = (d: KommunikationsStelle[]): Quelle<KommunikationsStelle> => ({
    zustand: 'daten',
    daten: d,
  });

  it('meldet die Lücke, wenn nur S2 und eine Behörde Verbindungen tragen', () => {
    const l = leitstelleOhneVerbindung(daten([stelle(1, 'funktion', 1), stelle(2, 'behoerde', 1)]));
    expect(l).toEqual({ zustand: 'daten', fehlt: true });
  });

  it('zählt eine Leitstelle ohne Verbindung als fehlend', () => {
    expect(leitstelleOhneVerbindung(daten([stelle(1, 'leitstelle')])).fehlt).toBe(true);
  });

  it('schließt die Lücke, sobald eine Leitstelle eine Verbindung trägt', () => {
    const l = leitstelleOhneVerbindung(
      daten([stelle(1, 'leitstelle'), stelle(2, 'leitstelle', 1)]),
    );
    expect(l).toEqual({ zustand: 'daten', fehlt: false });
  });

  it('behauptet ohne geladene Stellen nichts', () => {
    for (const zustand of ['laden', 'fehler', 'gesperrt'] as const) {
      expect(leitstelleOhneVerbindung({ zustand, daten: [] })).toEqual({ zustand, fehlt: false });
    }
  });
});

// ── Netz der Fernmeldeskizze (LFH-893 D11) ─────────────────────────────────────────────────────

const LEER_SKIZZE: Fernmeldeskizze = {
  lage: [],
  komponenten: [],
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
};
const skizze = (p: Partial<Fernmeldeskizze> = {}): SkizzenQuelle => ({
  zustand: 'daten',
  daten: { ...LEER_SKIZZE, ...p },
});

function externe(
  id: number,
  stellenart: KommunikationsStelle['stellenart'],
  {
    kanaele = [],
    verbindungen = 0,
  }: { kanaele?: [Sprechgruppe, Verbindungsstatus][]; verbindungen?: number } = {},
): KommunikationsStelleMitKanaelen {
  return {
    id,
    stellenart,
    bezeichnung: `Stelle ${id}`,
    verbindungen: Array.from({ length: verbindungen }, (_, i) => ({
      id: id * 10 + i,
      mittel: 'festnetz' as const,
      wert: '0421 1',
    })),
    sprechgruppen: kanaele.map(([sprechgruppe, status]) => ({ sprechgruppe, status })),
  };
}

function datenverbindung(
  id: number,
  von: SkizzenVerbindung['von'],
  nach: SkizzenVerbindung['nach'],
): SkizzenVerbindung {
  return {
    id,
    von,
    nach,
    art: 'daten',
    medium: 'leitung',
    status: 'bestehend',
    verkehr: null,
    hinweis: null,
  };
}

function netzQuellen(p: Partial<KanalQuellen> = {}): KanalQuellen {
  return {
    abschnitte: daten([]),
    einheiten: daten([]),
    fuehrungsstelle: ohneFs,
    sprechgruppen: daten([]),
    stellen: daten([]),
    skizze: skizze(),
    ...p,
  };
}

describe('kanalbelegung (LFH-893 D2)', () => {
  const BN = sgArt(1, 'BN_BOS', 'TMO');
  const F314 = sgArt(2, '314_F*', 'DMO');

  it('nennt je Sprechgruppe alle Teilnehmer: Führungsstelle, Abschnitte, Einheiten, Stellen, Komponenten', () => {
    const k = kanalbelegung(
      netzQuellen({
        fuehrungsstelle: fs([BN]),
        abschnitte: daten([abschnitt(1, [BN, F314])]),
        einheiten: daten([einheit(5, { sprechgruppen: [F314] })]),
        stellen: daten([externe(7, 'leitstelle', { kanaele: [[BN, 'geplant']] })]),
        skizze: skizze({
          komponenten: [{ id: 3, art: 'repeater', bezeichnung: null, sprechgruppen: [F314] }],
        }),
      }),
    );
    expect(k.get(1)?.teilnehmer).toEqual([
      { element: 'fs', status: 'bestehend' },
      { element: 'ab-1', status: 'bestehend' },
      { element: 'ks-7', status: 'geplant' },
    ]);
    expect(k.get(2)?.teilnehmer.map((t) => t.element)).toEqual(['ab-1', 'eh-5', 'ko-3']);
  });

  it('führt Führungsfunktionen nie als Teilnehmer', () => {
    const k = kanalbelegung(
      netzQuellen({ stellen: daten([externe(1, 'funktion', { kanaele: [[BN, 'bestehend']] })]) }),
    );
    expect(k.size).toBe(0);
  });

  it('nimmt einsatzlokale Sprechgruppen und Schienen mit Lagezeile ohne Teilnehmer auf', () => {
    const lokal = { ...sgArt(9, 'DMO 999', 'DMO'), einsatz_lokal: true };
    const k = kanalbelegung(
      netzQuellen({
        sprechgruppen: daten([lokal, F314, BN]),
        skizze: skizze({
          lage: [
            { element: 'sg-2', x: 0, y: 0, breite: 200, version: 1 },
            // Verwaist: die Sprechgruppe gibt es nicht (mehr).
            { element: 'sg-77', x: 0, y: 0, breite: 200, version: 1 },
          ],
        }),
      }),
    );
    expect([...k.keys()].sort()).toEqual([2, 9]);
    expect(k.get(2)?.teilnehmer).toEqual([]);
  });
});

describe('schienenMitEinemTeilnehmer (LFH-893 D11)', () => {
  const DMO505b = sgArt(3, 'DMO 505', 'DMO');

  it('trifft eine Sprechgruppe mit genau einem Teilnehmer (Szenario „nur ein Teilnehmer“)', () => {
    const l = schienenMitEinemTeilnehmer(
      netzQuellen({
        abschnitte: daten([abschnitt(1, [TMO311])]),
        einheiten: daten([
          einheit(1, { sprechgruppen: [TMO311, DMO505b] }),
          einheit(2, { sprechgruppen: [TMO311] }),
        ]),
      }),
    );
    expect(l).toEqual({ zustand: 'daten', treffer: [DMO505b] });
  });

  it('zählt Stelle und Komponente als Teilnehmer', () => {
    const l = schienenMitEinemTeilnehmer(
      netzQuellen({
        einheiten: daten([einheit(1, { sprechgruppen: [DMO505b] })]),
        skizze: skizze({
          komponenten: [{ id: 1, art: 'repeater', bezeichnung: null, sprechgruppen: [DMO505b] }],
        }),
      }),
    );
    expect(l.treffer).toEqual([]);
    const nurStelle = schienenMitEinemTeilnehmer(
      netzQuellen({
        stellen: daten([externe(1, 'leitstelle', { kanaele: [[TMO312, 'geplant']] })]),
      }),
    );
    expect(nurStelle.treffer).toEqual([TMO312]);
  });

  it('zählt eine lokale ohne Teilnehmer nicht, eine Katalog-Schiene nur mit Lagezeile schon', () => {
    const lokal = { ...sgArt(9, 'DMO 999', 'DMO'), einsatz_lokal: true };
    const l = schienenMitEinemTeilnehmer(
      netzQuellen({
        sprechgruppen: daten([lokal, TMO312]),
        skizze: skizze({ lage: [{ element: 'sg-2', x: 0, y: 0, breite: 160, version: 1 }] }),
      }),
    );
    expect(l.treffer).toEqual([TMO312]);
  });

  it('ordnet die Treffer TMO vor DMO', () => {
    const l = schienenMitEinemTeilnehmer(
      netzQuellen({
        einheiten: daten([
          einheit(1, { sprechgruppen: [DMO505b] }),
          einheit(2, { sprechgruppen: [TMO312] }),
        ]),
      }),
    );
    expect(l.treffer.map((s) => s.bezeichnung)).toEqual(['TMO 312', 'DMO 505']);
  });

  it.each(['abschnitte', 'einheiten', 'sprechgruppen', 'stellen'] as const)(
    'nennt ohne geladene Quelle %s den Zustand statt einer Zahl',
    (quelle) => {
      const l = schienenMitEinemTeilnehmer(
        netzQuellen({
          einheiten: daten([einheit(1, { sprechgruppen: [DMO505b] })]),
          [quelle]: { zustand: 'fehler', daten: [] },
        }),
      );
      expect(l).toEqual({ zustand: 'fehler', treffer: [] });
    },
  );

  it('nennt ohne Führungsstelle oder Skizzendaten den Zustand statt einer Zahl', () => {
    expect(
      schienenMitEinemTeilnehmer(
        netzQuellen({ fuehrungsstelle: { zustand: 'laden', daten: null } }),
      ),
    ).toEqual({ zustand: 'laden', treffer: [] });
    expect(
      schienenMitEinemTeilnehmer(netzQuellen({ skizze: { zustand: 'gesperrt', daten: null } })),
    ).toEqual({ zustand: 'gesperrt', treffer: [] });
  });
});

describe('leitstelleOhneVerbindung · Kanal und Skizze (LFH-893 D11)', () => {
  it('schließt die Lücke, wenn die Leitstelle nur eine Sprechgruppe trägt (Szenario „nur über Funk“)', () => {
    const l = leitstelleOhneVerbindung(
      daten([externe(1, 'leitstelle', { kanaele: [[TMO311, 'bestehend']] })]),
      daten<SkizzenVerbindung>([]),
    );
    expect(l).toEqual({ zustand: 'daten', fehlt: false });
  });

  it('schließt die Lücke über eine Verbindung der Skizze mit Bezug auf die Leitstelle', () => {
    const l = leitstelleOhneVerbindung(
      daten([externe(4, 'leitstelle'), externe(5, 'behoerde')]),
      daten([datenverbindung(1, { art: 'fuehrungsstelle', id: null }, { art: 'stelle', id: 4 })]),
    );
    expect(l).toEqual({ zustand: 'daten', fehlt: false });
  });

  it('zählt eine Skizzen-Verbindung einer anderen Stelle nicht', () => {
    const l = leitstelleOhneVerbindung(
      daten([externe(4, 'leitstelle'), externe(5, 'behoerde')]),
      daten([
        datenverbindung(1, { art: 'stelle', id: 5 }, { art: 'fuehrungsstelle', id: null }),
        // Gleiche id, andere Art: eine Einheit 4 ist nicht die Stelle 4.
        datenverbindung(2, { art: 'einheit', id: 4 }, { art: 'abschnitt', id: 1 }),
      ]),
    );
    expect(l).toEqual({ zustand: 'daten', fehlt: true });
  });

  it('urteilt ohne Skizzendaten aus den übrigen Angaben, wenn diese schon eine Verbindung belegen', () => {
    const l = leitstelleOhneVerbindung(daten([externe(1, 'leitstelle', { verbindungen: 1 })]), {
      zustand: 'fehler',
      daten: [],
    });
    expect(l).toEqual({ zustand: 'daten', fehlt: false });
  });

  it('nennt ohne Skizzendaten sonst den Zustand statt „fehlt“', () => {
    for (const zustand of ['laden', 'fehler', 'gesperrt'] as const) {
      const l = leitstelleOhneVerbindung(daten([externe(1, 'leitstelle')]), {
        zustand,
        daten: [],
      });
      expect(l).toEqual({ zustand, fehlt: false });
    }
  });

  it('nennt ohne geladene Stellen den Zustand der Stellen', () => {
    const l = leitstelleOhneVerbindung({ zustand: 'gesperrt', daten: [] }, daten([]));
    expect(l).toEqual({ zustand: 'gesperrt', fehlt: false });
  });
});
