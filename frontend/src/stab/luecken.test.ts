import { describe, expect, it } from 'vitest';
import type { Einheit, Einsatzabschnitt, KommunikationsStelle, Sprechgruppe } from '../api/types';
import {
  abschnitteOhneSprechgruppe,
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
    );
    expect(l.zustand).toBe('daten');
    expect(l.treffer.map((s) => s.bezeichnung)).toEqual(['DMO 999']);
  });

  it('nimmt den schlechtesten Zustand der drei Quellen und behauptet dann keine Zahl', () => {
    const l = lokaleSprechgruppenOhneZuordnung(daten([lokalFrei]), daten([]), gesperrt());
    expect(l).toEqual({ zustand: 'gesperrt', treffer: [] });
    expect(lokaleSprechgruppenOhneZuordnung(laden(), daten([]), daten([])).zustand).toBe('laden');
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
    const l = verbindungenOhneGemeinsameSprechgruppe(daten(abschnitte), daten(einheiten));
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
      verbindungenOhneGemeinsameSprechgruppe(daten(abschnitte), daten(einheiten)).treffer,
    ).toEqual([]);
  });

  it('nimmt eine Einheit mit unbekannter übergeordneter Einheit als oberste ihres Abschnitts', () => {
    const abschnitte = [ab(1, [TMO311])];
    const einheiten = [eh(11, [DMO506], { abschnitt_id: 1, ueber_einheit_id: 999 })];
    expect(
      verbindungenOhneGemeinsameSprechgruppe(daten(abschnitte), daten(einheiten)).treffer,
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
      verbindungenOhneGemeinsameSprechgruppe(daten(abschnitte), daten(einheiten)).treffer,
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
      );
      expect(l).toEqual({ zustand, treffer: [] });
    },
  );

  it('hat ohne Abschnitte keine Zahl', () => {
    const l = verbindungenOhneGemeinsameSprechgruppe(
      { zustand: 'gesperrt', daten: [] },
      daten([eh(10, [TMO312])]),
    );
    expect(l).toEqual({ zustand: 'gesperrt', treffer: [] });
  });
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
