import { describe, expect, it } from 'vitest';
import type { EinsatzAnzeige, ModulFreigaben } from '../../api/types';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { freigabenFixture } from '../../test/fixtures';
import {
  STARTLISTE_MODUL,
  startliste,
  startlisteOffen,
  type StartlisteQuellen,
  type StartPunkt,
} from './startliste';

/**
 * Startliste im Überblick (LLH-1815, Spec `ueberblick-startliste`, design.md D1): je Regel der Spec
 * ein Fall. Die Quellen stehen so, wie die Seite sie reicht: Daten nur, wenn der Abruf gelang.
 */

type Einsatzkopf = Pick<
  EinsatzAnzeige,
  'einsatzort' | 'einsatzort_lat' | 'einsatzort_lon' | 'einsatzleiter'
>;

const leererKopf: Einsatzkopf = {
  einsatzort: null,
  einsatzort_lat: null,
  einsatzort_lon: null,
  einsatzleiter: null,
};

const anna = {
  art: 'personal',
  name: 'Anna Schulz',
  personal_id: 3,
  personal_noch_disponiert: true,
  seit: '2026-11-17 08:00:00',
} as const;

/** Ein gerade angelegter Einsatz: alles leer, alles frei. */
function quellen(over: Partial<StartlisteQuellen> = {}): StartlisteQuellen {
  return {
    einsatzId: 7,
    einsatz: { zustand: 'daten', daten: leererKopf },
    abschnitte: { zustand: 'daten', daten: [] },
    einheiten: { zustand: 'daten', daten: [] },
    personal: { zustand: 'daten', daten: [] },
    lage: { zustand: 'daten', daten: [] },
    freigaben: freigabenFixture(),
    ...over,
  };
}

const kopf = (over: Partial<Einsatzkopf>) =>
  ({ zustand: 'daten', daten: { ...leererKopf, ...over } }) as const;

const punkt = (punkte: StartPunkt[], schluessel: StartPunkt['schluessel']) => {
  const p = punkte.find((x) => x.schluessel === schluessel);
  if (!p) throw new Error(`Punkt ${schluessel} fehlt`);
  return p;
};

describe('startliste (LLH-1815)', () => {
  it('leerer Einsatz: fünf Punkte in der Reihenfolge der Spec, alle offen, jeder mit Ziel', () => {
    const punkte = startliste(quellen());
    expect(punkte.map((p) => [p.schluessel, p.titel, p.zustand])).toEqual([
      ['einsatzort', 'Einsatzort', 'offen'],
      ['einsatzleiter', 'Einsatzleiter', 'offen'],
      ['einsatzabschnitte', 'Einsatzabschnitte', 'offen'],
      ['kraefte', 'Kräfte', 'offen'],
      ['lage', 'Erste Lagefeststellung', 'offen'],
    ]);
    expect(punkte.map((p) => p.ziel)).toEqual([
      '/einsaetze/7/einsatzdaten?paneel=einsatzort',
      '/einsaetze/7/einsatzdaten?paneel=fuehrungsstelle',
      '/einsaetze/7/einsatzabschnitte?neu=1',
      '/einsaetze/7/einheiten',
      '/einsaetze/7/etb?neu=1',
    ]);
    expect(startlisteOffen(punkte)).toBe(true);
  });

  it('Einsatzort mit Koordinate: erledigt mit Ortstext, ohne Zusatz und ohne Ziel', () => {
    const p = punkt(
      startliste(
        quellen({
          einsatz: kopf({ einsatzort: 'Deich West', einsatzort_lat: 52.1, einsatzort_lon: 9.3 }),
        }),
      ),
      'einsatzort',
    );
    expect(p).toMatchObject({ zustand: 'erledigt', wert: 'Deich West' });
    expect(p.zusatz).toBeUndefined();
    expect(p.ziel).toBeUndefined();
  });

  it('Einsatzort ohne Koordinate: erledigt mit dem Zusatz „nicht verortet“', () => {
    const p = punkt(
      startliste(quellen({ einsatz: kopf({ einsatzort: 'Deich West' }) })),
      'einsatzort',
    );
    expect(p).toMatchObject({ zustand: 'erledigt', wert: 'Deich West', zusatz: 'nicht verortet' });
  });

  it('Einsatzort nur aus Leerzeichen bleibt offen, eine Koordinate allein auch', () => {
    const nurLeer = startliste(quellen({ einsatz: kopf({ einsatzort: '   ' }) }));
    expect(punkt(nurLeer, 'einsatzort').zustand).toBe('offen');
    const nurPunkt = startliste(
      quellen({ einsatz: kopf({ einsatzort_lat: 52.1, einsatzort_lon: 9.3 }) }),
    );
    expect(punkt(nurPunkt, 'einsatzort').zustand).toBe('offen');
  });

  it('Einsatzleiter erfasst: erledigt mit dem Namen aus dem Anzeigehelfer', () => {
    const p = punkt(
      startliste(quellen({ einsatz: kopf({ einsatzleiter: anna }) })),
      'einsatzleiter',
    );
    expect(p).toMatchObject({ zustand: 'erledigt', wert: 'Anna Schulz' });
    const extern = punkt(
      startliste(
        quellen({
          einsatz: kopf({ einsatzleiter: { art: 'extern', name: 'KBM Weber', seit: anna.seit } }),
        }),
      ),
      'einsatzleiter',
    );
    expect(extern.wert).toBe('KBM Weber (extern)');
  });

  it('Teilweise erledigt: Einsatzleiter und ein Abschnitt, die übrigen drei offen', () => {
    const punkte = startliste(
      quellen({
        einsatz: kopf({ einsatzleiter: anna }),
        abschnitte: { zustand: 'daten', daten: [{ id: 1 }] },
      }),
    );
    expect(punkte.map((p) => p.zustand)).toEqual([
      'offen',
      'erledigt',
      'erledigt',
      'offen',
      'offen',
    ]);
    expect(punkt(punkte, 'einsatzabschnitte').wert).toBeUndefined();
  });

  it('Kräfte: eine Einheit genügt, eine Einsatzkraft allein auch, keine Zahl als Wert', () => {
    const nurEinheit = punkt(
      startliste(quellen({ einheiten: { zustand: 'daten', daten: [{ id: 1 }, { id: 2 }] } })),
      'kraefte',
    );
    expect(nurEinheit.zustand).toBe('erledigt');
    expect(nurEinheit.wert).toBeUndefined();
    const nurPersonal = punkt(
      startliste(quellen({ personal: { zustand: 'daten', daten: [{ id: 3 }] } })),
      'kraefte',
    );
    expect(nurPersonal.zustand).toBe('erledigt');
  });

  it('Kräfte: Personal gesperrt und keine Einheit bleibt offen (der Weg in die Einheiten steht)', () => {
    const p = punkt(
      startliste(
        quellen({
          personal: { zustand: 'gesperrt' },
          freigaben: freigabenFixture({ personal: { zugriff: false } }),
        }),
      ),
      'kraefte',
    );
    expect(p.zustand).toBe('offen');
  });

  it('Kräfte: Personal ausgefallen und keine Einheit ist unbekannt, eine Einheit trotzdem erledigt', () => {
    expect(punkt(startliste(quellen({ personal: { zustand: 'fehler' } })), 'kraefte').zustand).toBe(
      'unbekannt',
    );
    expect(
      punkt(
        startliste(
          quellen({
            personal: { zustand: 'fehler' },
            einheiten: { zustand: 'daten', daten: [{ id: 1 }] },
          }),
        ),
        'kraefte',
      ).zustand,
    ).toBe('erledigt');
  });

  it('erste Lagefeststellung: ein Eintrag „Lage“ erledigt sie; die Quelle trägt nur Lage', () => {
    const p = punkt(
      startliste(quellen({ lage: { zustand: 'daten', daten: [{ id: 9 }] } })),
      'lage',
    );
    expect(p.zustand).toBe('erledigt');
  });

  it('Entscheidung ist keine Lagefeststellung: ohne Lage-Eintrag bleibt der Punkt offen', () => {
    // Die Seite fragt nur `typ: 'lage'` ab; eine Entscheidung kommt in dieser Quelle nicht vor.
    expect(punkt(startliste(quellen()), 'lage').zustand).toBe('offen');
  });

  it('Quelle ausgefallen: der Punkt ist unbekannt, nie offen oder erledigt, und die Liste offen', () => {
    const punkte = startliste(
      quellen({
        einsatz: kopf({ einsatzort: 'Deich West', einsatzleiter: anna }),
        abschnitte: { zustand: 'fehler' },
        einheiten: { zustand: 'daten', daten: [{ id: 1 }] },
        lage: { zustand: 'daten', daten: [{ id: 9 }] },
      }),
    );
    const p = punkt(punkte, 'einsatzabschnitte');
    expect(p).toMatchObject({ zustand: 'unbekannt', grund: 'nicht geladen' });
    expect(p.ziel).toBeUndefined();
    expect(startlisteOffen(punkte)).toBe(true);
  });

  it('eine noch ladende Quelle ist unbekannt', () => {
    expect(punkt(startliste(quellen({ lage: { zustand: 'laden' } })), 'lage').zustand).toBe(
      'unbekannt',
    );
  });

  it('alle erledigt: die Liste ist nicht offen', () => {
    const punkte = startliste(
      quellen({
        einsatz: kopf({ einsatzort: 'Deich West', einsatzleiter: anna }),
        abschnitte: { zustand: 'daten', daten: [{ id: 1 }] },
        einheiten: { zustand: 'daten', daten: [{ id: 1 }] },
        lage: { zustand: 'daten', daten: [{ id: 9 }] },
      }),
    );
    expect(punkte.every((p) => p.zustand === 'erledigt')).toBe(true);
    expect(startlisteOffen(punkte)).toBe(false);
  });

  it('ohne bekannte Freigaben sperrt nichts; die Punkte folgen ihren Quellen', () => {
    const punkte = startliste(
      quellen({
        freigaben: undefined,
        abschnitte: { zustand: 'fehler' },
        einheiten: { zustand: 'fehler' },
        personal: { zustand: 'fehler' },
        lage: { zustand: 'fehler' },
      }),
    );
    expect(punkte.map((p) => p.zustand)).toEqual([
      'offen',
      'offen',
      'unbekannt',
      'unbekannt',
      'unbekannt',
    ]);
  });
});

describe('startliste · Modulsperre (LLH-1815, Aufgabe 1.2)', () => {
  it('jeder Punkt hängt an einem Modul der Registry', () => {
    const keys = new Set(modulRegistry.map((m) => m.key));
    for (const [schluessel, modul] of Object.entries(STARTLISTE_MODUL)) {
      expect(keys.has(modul), `${schluessel} → ${modul}`).toBe(true);
    }
    expect(STARTLISTE_MODUL).toEqual({
      einsatzort: 'einsatzdaten',
      einsatzleiter: 'einsatzdaten',
      einsatzabschnitte: 'einsatzabschnitte',
      kraefte: 'einheiten',
      lage: 'etb',
    });
  });

  it('ETB gesperrt: der Punkt steht „—“ mit dem Grund der Sperrlogik, ohne Ziel', () => {
    const p = punkt(
      startliste(
        quellen({
          lage: { zustand: 'gesperrt' },
          freigaben: freigabenFixture({ etb: { zugriff: false } }),
        }),
      ),
      'lage',
    );
    expect(p).toMatchObject({ zustand: 'gesperrt', grund: 'nicht freigegeben' });
    expect(p.ziel).toBeUndefined();
  });

  it('ein ausgeblendetes Modul gilt als gesperrt', () => {
    const p = punkt(
      startliste(
        quellen({
          freigaben: freigabenFixture({ einsatzabschnitte: { sichtbar: false, zugriff: false } }),
        }),
      ),
      'einsatzabschnitte',
    );
    expect(p.zustand).toBe('gesperrt');
  });

  it('ETB gesperrt, sonst erledigt: startlisteOffen ist falsch', () => {
    const freigaben: ModulFreigaben = freigabenFixture({ etb: { zugriff: false } });
    const punkte = startliste(
      quellen({
        einsatz: kopf({ einsatzort: 'Deich West', einsatzleiter: anna }),
        abschnitte: { zustand: 'daten', daten: [{ id: 1 }] },
        personal: { zustand: 'daten', daten: [{ id: 3 }] },
        lage: { zustand: 'gesperrt' },
        freigaben,
      }),
    );
    expect(punkt(punkte, 'lage').zustand).toBe('gesperrt');
    expect(startlisteOffen(punkte)).toBe(false);
  });

  it('Einheiten gesperrt: Kräfte gesperrt, auch wenn Personal da ist', () => {
    const p = punkt(
      startliste(
        quellen({
          einheiten: { zustand: 'gesperrt' },
          personal: { zustand: 'daten', daten: [{ id: 3 }] },
          freigaben: freigabenFixture({ einheiten: { zugriff: false } }),
        }),
      ),
      'kraefte',
    );
    expect(p.zustand).toBe('gesperrt');
  });
});
