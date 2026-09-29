import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import type { FreiesZeichenUpdate } from '../../api/types';
import type { GeoJsonGeometry, GeoJsonPolygon } from './geo';
import type { KarteMarker } from './marker';
import { useKartenInteraktion } from './useKartenInteraktion';
import { einsatzKeys } from '../../api/queryKeys';
import { leseZuletztVerwendet } from './zuletztVerwendet';

// API-Client der freien Zeichen mocken; hier nur die Aufrufe prüfen.
const freieZeichenApi = vi.hoisted(() => ({
  legeFreiesZeichenAn: vi.fn(() => Promise.resolve({ id: 42 })),
  aktualisiereFreiesZeichen: vi.fn(() => Promise.resolve({ id: 42 })),
  loescheFreiesZeichen: vi.fn(() => Promise.resolve()),
  verschiebeFreiesZeichen: vi.fn(() => Promise.resolve({ id: 42 })),
}));
vi.mock('../../api/freieZeichen', () => freieZeichenApi);

// Zonen-API mocken. Die Factory muss jeden vom Hook importierten Export tragen, sonst scheitert die
// Modul-Initialisierung der ganzen Datei.
const lagezonenApi = vi.hoisted(() => ({
  legeZoneAn: vi.fn(() => Promise.resolve({ id: 5 })),
  aktualisiereZone: vi.fn(() => Promise.resolve({ id: 5 })),
  loescheZone: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../api/lagezonen', () => lagezonenApi);

const einsatzUhsApi = vi.hoisted(() => ({
  aktualisiereUhs: vi.fn(() => Promise.resolve({ id: 2 })),
}));
vi.mock('../../api/einsatzUhs', () => einsatzUhsApi);

// Betroffene verorten: der Platzier-Auftrag `person` schreibt die Fundort-Koordinate.
const einsatzPersonApi = vi.hoisted(() => ({
  aktualisierePerson: vi.fn(() => Promise.resolve({ id: 10 })),
}));
vi.mock('../../api/einsatzPerson', () => einsatzPersonApi);

// Betreuungsstelle verorten: der Platzier-Auftrag `betreuungsstelle` PATCHt die Stelle.
const betreuungApi = vi.hoisted(() => ({
  aendereStelle: vi.fn(() => Promise.resolve({ id: 4 })),
}));
vi.mock('../../api/betreuung', () => betreuungApi);

// Die übrigen Zweige von `loescheVerortung`: je Objektart eine eigene API.
const einsatzSchadenApi = vi.hoisted(() => ({
  aktualisiereSchaden: vi.fn(() => Promise.resolve({ id: 3 })),
}));
vi.mock('../../api/einsatzSchaden', () => einsatzSchadenApi);
const einheitenApi = vi.hoisted(() => ({
  verorteEinheit: vi.fn(() => Promise.resolve({ id: 5 })),
}));
vi.mock('../../api/einheiten', () => einheitenApi);
const einsatzFahrzeugeApi = vi.hoisted(() => ({
  verorteFahrzeug: vi.fn(() => Promise.resolve({ id: 6 })),
}));
vi.mock('../../api/einsatzFahrzeuge', () => einsatzFahrzeugeApi);
const einsatzPersonalApi = vi.hoisted(() => ({
  verortePerson: vi.fn(() => Promise.resolve({ id: 7 })),
}));
vi.mock('../../api/einsatzPersonal', () => einsatzPersonalApi);
const einsatzabschnitteApi = vi.hoisted(() => ({
  zeichneAbschnitt: vi.fn(() => Promise.resolve({ id: 8 })),
}));
vi.mock('../../api/einsatzabschnitte', () => einsatzabschnitteApi);

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function rendere(fehler: (e: unknown) => void = vi.fn(), erfolg: (text: string) => void = vi.fn()) {
  return renderHook(
    () =>
      useKartenInteraktion({
        einsatzId: 1,
        einsatz: undefined,
        darfSchreiben: true,
        waehlbar: [],
        fehler,
        erfolg,
      }),
    { wrapper: wrapper() },
  );
}

type HookResult = ReturnType<typeof rendere>['result'];

const POLYGON: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};

// Jeder wechselseitig exklusive Interaktionsmodus samt Start-Sequenz. Während eines Modus darf ein
// Karten-Klick kein Auswahl-Panel öffnen (sonst Doppel-Panel neben der ZeichnenSteuerung).
// `familie` ist die Modus-Identität: zone-zeichnen und zone-bestaetigung sind zwei Phasen desselben
// Modus und dürfen koexistieren; zwei verschiedene Familien gleichzeitig sind ein Defekt.
const MODI: { name: string; familie: string; betreten: (r: HookResult) => void }[] = [
  {
    name: 'platzieren',
    familie: 'platzieren',
    betreten: (r) => act(() => r.current.onPlatzierenStart({ typ: 'uhs', id: 2 })),
  },
  {
    name: 'bild-platzieren',
    familie: 'bild',
    betreten: (r) => act(() => r.current.onBildPlatzieren(7)),
  },
  {
    name: 'abschnitt-zeichnen',
    familie: 'abschnitt',
    betreten: (r) => act(() => r.current.onAbschnittZeichnenStart(3)),
  },
  {
    name: 'zone-zeichnen',
    familie: 'zone',
    betreten: (r) =>
      act(() => r.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' })),
  },
  {
    name: 'zone-bestaetigung',
    familie: 'zone',
    betreten: (r) => {
      act(() => r.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
      act(() => r.current.onZoneGezeichnet(POLYGON));
    },
  },
  // Das Platzieren eines freien Zeichens ist exklusiv und muss das Selektions-Gate auslösen.
  {
    name: 'zeichen-platzieren',
    familie: 'zeichen',
    betreten: (r) => act(() => r.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' })),
  },
  // Messen zeichnet auf der Karte und ist damit exklusiv.
  {
    name: 'messen',
    familie: 'messen',
    betreten: (r) => act(() => r.current.onMessenStart('strecke')),
  },
];

/** Welche Modus-Familien sind gerade scharf? Mehr als eine = verletzte Exklusivität. */
function aktiveFamilien(r: HookResult): string[] {
  const f = new Set<string>();
  if (r.current.platzierungZiel != null) f.add('platzieren');
  if (r.current.bildPlatzierenId != null) f.add('bild');
  if (r.current.zeichneAbschnittId != null) f.add('abschnitt');
  if (r.current.zoneEntwurf != null || r.current.zoneBestaetigung != null) f.add('zone');
  if (r.current.zeichenPlatzieren != null) f.add('zeichen');
  if (r.current.messForm != null) f.add('messen');
  return [...f].sort();
}

// Das Kreuzprodukt prüft die Exklusivität der Modi erschöpfend statt stichprobenartig.
describe('useKartenInteraktion — Exklusivität der Interaktionsmodi (LFH-243)', () => {
  for (const zuerst of MODI) {
    for (const dann of MODI) {
      if (zuerst.familie === dann.familie) continue; // gleiche Familie: kein Wechsel
      it(`${zuerst.name} → ${dann.name}: nur ${dann.familie} bleibt scharf`, () => {
        const { result } = rendere();
        zuerst.betreten(result);
        expect(aktiveFamilien(result)).toEqual([zuerst.familie]);

        dann.betreten(result);
        expect(aktiveFamilien(result)).toEqual([dann.familie]);
      });
    }
  }

  // onEinsatzortPlatzieren ist ein eigener Start-Handler der Familie `platzieren`, den das
  // Kreuzprodukt überspringt.
  for (const zuerst of MODI.filter((m) => m.familie !== 'platzieren')) {
    it(`${zuerst.name} → einsatzort-platzieren: nur platzieren bleibt scharf`, () => {
      const { result } = rendere();
      zuerst.betreten(result);
      act(() => result.current.onEinsatzortPlatzieren());
      expect(aktiveFamilien(result)).toEqual(['platzieren']);
    });
  }

  // Phasen-Invariante der zone-Familie: der sichtbare Entwurf bleibt stehen, solange die
  // Bestätigung offen ist.
  it('onZoneGezeichnet öffnet die Bestätigung, OHNE den Entwurf zu verlieren', () => {
    const { result } = rendere();
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    act(() => result.current.onZoneGezeichnet(POLYGON));
    expect(result.current.zoneEntwurf).not.toBeNull();
    expect(result.current.zoneBestaetigung).not.toBeNull();
  });
});

// Die drei Auswahl-States (`auswahl`, `zoneAuswahl`, `fachebeneAuswahl`) sind wechselseitig
// exklusiv: LagekartePage rendert jeden Inspektor unabhängig, zwei gleichzeitig wären zwei Panels.
const SELEKTIONEN: {
  name: string;
  feld: 'auswahl' | 'zoneAuswahl' | 'fachebeneAuswahl';
  waehlen: (r: HookResult) => void;
}[] = [
  {
    name: 'marker',
    feld: 'auswahl',
    waehlen: (r) => act(() => r.current.onMarkerWaehlen('uhs-1')),
  },
  { name: 'abschnitt', feld: 'auswahl', waehlen: (r) => act(() => r.current.onFlaecheKlick(3)) },
  { name: 'zone', feld: 'zoneAuswahl', waehlen: (r) => act(() => r.current.onZoneKlick(5)) },
  {
    name: 'fachebene',
    feld: 'fachebeneAuswahl',
    waehlen: (r) => act(() => r.current.onFachebeneKlick({ a: 1 }, 'nina')),
  },
];

function aktiveSelektionen(r: HookResult): string[] {
  const f: string[] = [];
  if (r.current.auswahl != null) f.push('auswahl');
  if (r.current.zoneAuswahl != null) f.push('zoneAuswahl');
  if (r.current.fachebeneAuswahl != null) f.push('fachebeneAuswahl');
  return f.sort();
}

describe('useKartenInteraktion — Exklusivität der Auswahl-Panels (LFH-243)', () => {
  for (const zuerst of SELEKTIONEN) {
    for (const dann of SELEKTIONEN) {
      if (zuerst.feld === dann.feld) continue;
      it(`${zuerst.name} → ${dann.name}: nur ${dann.feld} bleibt gesetzt`, () => {
        const { result } = rendere();
        zuerst.waehlen(result);
        expect(aktiveSelektionen(result)).toEqual([zuerst.feld]);

        dann.waehlen(result);
        expect(aktiveSelektionen(result)).toEqual([dann.feld]);
      });
    }
  }
});

describe('useKartenInteraktion — Verorten', () => {
  it('sendet bei zwei Klicks im selben Renderfenster nur eine Positionsänderung', async () => {
    let freigeben: (() => void) | undefined;
    einsatzUhsApi.aktualisiereUhs.mockReset();
    einsatzUhsApi.aktualisiereUhs.mockImplementation(
      () =>
        new Promise((resolve) => {
          freigeben = () => resolve({ id: 2 });
        }),
    );
    const { result } = rendere();

    act(() => result.current.onPlatzierenStart({ typ: 'uhs', id: 2 }));
    act(() => {
      result.current.onKarteKlick({ lng: 8.6, lat: 50.1 });
      result.current.onKarteKlick({ lng: 8.7, lat: 50.2 });
    });

    await waitFor(() => expect(einsatzUhsApi.aktualisiereUhs).toHaveBeenCalledTimes(1));
    expect(einsatzUhsApi.aktualisiereUhs).toHaveBeenCalledWith(1, 2, { lat: 50.1, lon: 8.6 });
    await act(async () => {
      freigeben?.();
    });
    einsatzUhsApi.aktualisiereUhs.mockReset();
    einsatzUhsApi.aktualisiereUhs.mockImplementation(() => Promise.resolve({ id: 2 }));
  });
});

describe('useKartenInteraktion — Betroffene verorten (LFH-613)', () => {
  it('Platzier-Auftrag person: Klick PATCHt NUR die Fundort-Koordinate und invalidiert die Personen', async () => {
    einsatzPersonApi.aktualisierePerson.mockClear();
    const client = neuerQueryClient();
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    const erfolg = vi.fn();
    const { result } = renderHook(
      () =>
        useKartenInteraktion({
          einsatzId: 1,
          einsatz: undefined,
          darfSchreiben: true,
          waehlbar: [],
          fehler: vi.fn(),
          erfolg,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );

    act(() => result.current.onPlatzierenStart({ typ: 'person', id: 10 }));
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));

    await waitFor(() => expect(einsatzPersonApi.aktualisierePerson).toHaveBeenCalledTimes(1));
    // Genau die zwei Felder — kein weiterer Key, der als „leeren" gelesen würde.
    expect(einsatzPersonApi.aktualisierePerson).toHaveBeenCalledWith(1, 10, {
      antreff_lat: 50.1,
      antreff_lon: 8.6,
    });
    await waitFor(() => expect(erfolg).toHaveBeenCalledWith('Objekt verortet'));
    const keys = invalidiert.mock.calls.map((c) => c[0]?.queryKey);
    // Literale statt Factory, sonst prüfte der Test die Factory gegen sich selbst.
    expect(keys).toContainEqual(['einsatz-personen', 1]);
    expect(keys).toContainEqual(['einsatz-person', 1, 10]);
    expect(result.current.platzierungZiel).toBeNull();
  });
});

describe('useKartenInteraktion — Betroffene: Verortung löschen (LFH-648)', () => {
  it('leert NUR die Fundort-Koordinate und invalidiert Liste und Person', async () => {
    einsatzPersonApi.aktualisierePerson.mockClear();
    const client = neuerQueryClient();
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () =>
        useKartenInteraktion({
          einsatzId: 1,
          einsatz: undefined,
          darfSchreiben: true,
          waehlbar: [],
          fehler: vi.fn(),
          erfolg: vi.fn(),
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );

    act(() =>
      result.current.loescheVerortung({
        schluessel: 'person-10',
        typ: 'person',
        id: 10,
        lat: 50.1,
        lon: 8.6,
        label: 'R-010 · SK II',
        farbe: '#000',
      }),
    );

    await waitFor(() => expect(einsatzPersonApi.aktualisierePerson).toHaveBeenCalledTimes(1));
    // Genau die zwei Felder: `patchBody` liest vorhandene Keys, jeder weitere wäre ein „leeren".
    expect(einsatzPersonApi.aktualisierePerson).toHaveBeenCalledWith(1, 10, {
      antreff_lat: null,
      antreff_lon: null,
    });
    await waitFor(() => {
      const keys = invalidiert.mock.calls.map((c) => c[0]?.queryKey);
      expect(keys).toContainEqual(['einsatz-personen', 1]);
      expect(keys).toContainEqual(['einsatz-person', 1, 10]);
    });
  });
});

describe('useKartenInteraktion — Selektions-Gate während exklusiver Modi (LFH-208)', () => {
  describe('Baseline: ohne aktiven Modus selektiert der Klick normal', () => {
    it('onZoneKlick setzt zoneAuswahl', () => {
      const { result } = rendere();
      act(() => result.current.onZoneKlick(5));
      expect(result.current.zoneAuswahl).toBe(5);
    });
    it('onFachebeneKlick reicht die (un-geclippte) Geometrie an fachebeneAuswahl durch (LFH-146)', () => {
      const { result } = rendere();
      const geom = {
        type: 'Polygon',
        coordinates: [
          [
            [8, 50],
            [8.1, 50],
            [8.1, 50.1],
            [8, 50],
          ],
        ],
      };
      act(() => result.current.onFachebeneKlick({ a: 1 }, 'nina', geom));
      expect(result.current.fachebeneAuswahl?.geometrie).toBe(geom);
    });
    it('onFlaecheKlick setzt auswahl auf abschnitt-<id>', () => {
      const { result } = rendere();
      act(() => result.current.onFlaecheKlick(3));
      expect(result.current.auswahl).toBe('abschnitt-3');
    });
    it('onFachebeneKlick setzt fachebeneAuswahl', () => {
      const { result } = rendere();
      act(() => result.current.onFachebeneKlick({ a: 1 }, 'nina'));
      expect(result.current.fachebeneAuswahl).not.toBeNull();
    });
  });

  it('exklusiverModusAktiv ist ohne aktiven Modus false', () => {
    const { result } = rendere();
    expect(result.current.exklusiverModusAktiv).toBe(false);
  });

  describe.each(MODI)('Modus „$name"', ({ betreten }) => {
    it('setzt exklusiverModusAktiv=true', () => {
      const { result } = rendere();
      betreten(result);
      expect(result.current.exklusiverModusAktiv).toBe(true);
    });
    it('onZoneKlick öffnet kein Zonen-Panel (No-op)', () => {
      const { result } = rendere();
      betreten(result);
      act(() => result.current.onZoneKlick(5));
      expect(result.current.zoneAuswahl).toBeNull();
    });
    it('onFlaecheKlick öffnet kein Abschnitt-Panel (No-op)', () => {
      const { result } = rendere();
      betreten(result);
      act(() => result.current.onFlaecheKlick(3));
      expect(result.current.auswahl).toBeNull();
    });
    it('onFachebeneKlick öffnet kein Fachebenen-Panel (No-op)', () => {
      const { result } = rendere();
      betreten(result);
      act(() => result.current.onFachebeneKlick({ a: 1 }, 'nina'));
      expect(result.current.fachebeneAuswahl).toBeNull();
    });
  });
});

describe('useKartenInteraktion — freies Zeichen platzieren (LFH-170)', () => {
  it('onZeichenPlatzierenStart setzt zeichenPlatzieren und resettet andere Modi', () => {
    const { result } = rendere();
    act(() => result.current.onPlatzierenStart({ typ: 'uhs', id: 2 }));
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    expect(result.current.zeichenPlatzieren).toEqual({ grundzeichen: 'stelle' });
    expect(result.current.platzierungZiel).toBeNull();
  });

  it('ein anderer Start-Modus resettet zeichenPlatzieren (Mutual-Exclusion, LFH-145)', () => {
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    expect(result.current.zeichenPlatzieren).toBeNull();
  });

  // Jeder weitere exklusive Start-Handler räumt einen offenen zeichenPlatzieren-Modus
  // (onZoneZeichnenStart ist oben geprüft).
  const RAEUMT_ZEICHEN_PLATZIEREN: { name: string; start: (r: HookResult) => void }[] = [
    {
      name: 'onAbschnittZeichnenStart',
      start: (r) => act(() => r.current.onAbschnittZeichnenStart(3)),
    },
    { name: 'onEinsatzortPlatzieren', start: (r) => act(() => r.current.onEinsatzortPlatzieren()) },
    { name: 'onBildPlatzieren', start: (r) => act(() => r.current.onBildPlatzieren(7)) },
  ];
  describe.each(RAEUMT_ZEICHEN_PLATZIEREN)('$name räumt zeichenPlatzieren', ({ start }) => {
    it('setzt einen offenen zeichenPlatzieren-Modus auf null', () => {
      const { result } = rendere();
      act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
      expect(result.current.zeichenPlatzieren).toEqual({ grundzeichen: 'stelle' });
      start(result);
      expect(result.current.zeichenPlatzieren).toBeNull();
    });
  });

  it('onZeichenPlatzierenStart räumt eine offene zoneBestaetigung (Mutual-Exclusion)', () => {
    const { result } = rendere();
    // zoneBestaetigung aufbauen: Zone-Zeichnen starten, Geometrie abschließen (vgl. MODI
    // „zone-bestaetigung").
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    act(() => result.current.onZoneGezeichnet(POLYGON));
    expect(result.current.zoneBestaetigung).not.toBeNull();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    expect(result.current.zoneBestaetigung).toBeNull();
  });

  it('onKarteKlick bei aktivem zeichenPlatzieren legt ein freies Zeichen an (POST mit Klick-Koordinate)', async () => {
    freieZeichenApi.legeFreiesZeichenAn.mockClear();
    const erfolg = vi.fn();
    const { result } = rendere(vi.fn(), erfolg);
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle', label: 'X' }));
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));
    await waitFor(() =>
      expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledWith(1, {
        lat: 50.1,
        lon: 8.6,
        grundzeichen: 'stelle',
        label: 'X',
        // Ohne aktive Ansicht wird auf „alle Ansichten" (null) gestempelt.
        ansicht_id: null,
      }),
    );
    // Der Platzier-Modus überlebt den POST (Serie ist Vorgabe); der Zähler zeigt, dass onSuccess
    // gelaufen ist.
    await waitFor(() => expect(result.current.zeichenSerieAnzahl).toBe(1));
    expect(result.current.zeichenPlatzieren).toEqual({ grundzeichen: 'stelle', label: 'X' });
    expect(erfolg).toHaveBeenCalledWith('Taktisches Zeichen angelegt');
  });

  // „Zuletzt verwendet" zählt nur, was wirklich angelegt wurde — als Paar, sonst wäre ein Merken
  // beim Start ebenso grün.
  it('merkt das Zeichen nach erfolgreichem Anlegen unter „zuletzt verwendet"', async () => {
    localStorage.clear();
    freieZeichenApi.legeFreiesZeichenAn.mockClear();
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle', label: 'X' }));
    expect(leseZuletztVerwendet()).toEqual([]);
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));
    await waitFor(() => expect(result.current.zeichenSerieAnzahl).toBe(1));
    expect(leseZuletztVerwendet().map((z) => z.grundzeichen)).toEqual(['stelle']);
  });

  it('merkt das gesendete Zeichen auch, wenn der Modus vor der Antwort beendet wurde', async () => {
    // Gemerkt wird, was gesendet wurde, nicht, was beim Eintreffen der Antwort im Platzier-Modus
    // steht.
    localStorage.clear();
    let aufloesen: (v: { id: number }) => void = () => {};
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(
      () =>
        new Promise((r) => {
          aufloesen = r;
        }),
    );
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));
    await waitFor(() => expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledTimes(1));
    act(() => result.current.onZeichenPlatzierenFertig());
    expect(result.current.zeichenPlatzieren).toBeNull();
    await act(async () => aufloesen({ id: 7 }));
    await waitFor(() =>
      expect(leseZuletztVerwendet().map((z) => z.grundzeichen)).toEqual(['stelle']),
    );
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(() => Promise.resolve({ id: 42 }));
  });

  it('merkt nichts, wenn das Anlegen scheitert', async () => {
    localStorage.clear();
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(() => Promise.reject(new Error('500')));
    const fehler = vi.fn();
    const { result } = rendere(fehler);
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));
    await waitFor(() => expect(fehler).toHaveBeenCalled());
    expect(leseZuletztVerwendet()).toEqual([]);
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(() => Promise.resolve({ id: 42 }));
  });

  it('quittiert Zonenänderung und -löschung erst nach erfolgreicher API-Antwort', async () => {
    const erfolg = vi.fn();
    const { result } = rendere(vi.fn(), erfolg);

    await act(async () => {
      await result.current.zoneAendern(5, { label: 'Nord' });
    });
    expect(lagezonenApi.aktualisiereZone).toHaveBeenCalledWith(1, 5, { label: 'Nord' });
    expect(erfolg).toHaveBeenCalledWith('Zone gespeichert');

    await act(async () => {
      await result.current.zoneLoeschen(5);
    });
    expect(lagezonenApi.loescheZone).toHaveBeenCalledWith(1, 5);
    expect(erfolg).toHaveBeenCalledWith('Zone aufgehoben');
  });

  it('Doppelklick legt nur EIN freies Zeichen an (isPending-Guard, kein Duplikat)', async () => {
    // Mutation pending halten, damit der zweite Klick den Guard trifft. legeFreiesZeichenAn ist
    // nicht idempotent, ein zweiter Aufruf legte ein Duplikat an.
    let aufloesen: (v: { id: number }) => void = () => {};
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(
      () =>
        new Promise((r) => {
          aufloesen = r;
        }),
    );
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));
    await waitFor(() => expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledTimes(1));
    // zweiter Klick, während die erste Mutation noch pending ist → Guard greift
    act(() => result.current.onKarteKlick({ lng: 8.7, lat: 50.2 }));
    await new Promise((r) => setTimeout(r, 15));
    expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledTimes(1);
    aufloesen({ id: 1 });
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(() => Promise.resolve({ id: 42 }));
  });

  it('zeichenAendern(id, spec) ruft aktualisiereFreiesZeichen(einsatzId, id, spec)', async () => {
    freieZeichenApi.aktualisiereFreiesZeichen.mockClear();
    const { result } = rendere();
    const spec: FreiesZeichenUpdate = { grundzeichen: 'stelle', label: 'Neu' };
    act(() => {
      result.current.zeichenAendern(42, spec);
    });
    await waitFor(() =>
      expect(freieZeichenApi.aktualisiereFreiesZeichen).toHaveBeenCalledWith(1, 42, spec),
    );
  });

  it('zeichenLoeschen(id) ruft loescheFreiesZeichen(einsatzId, id) und setzt auswahl auf null', async () => {
    freieZeichenApi.loescheFreiesZeichen.mockClear();
    const { result } = rendere();
    // Erst das freie Zeichen selektieren → auswahl = 'freies_zeichen-42'.
    act(() => result.current.onMarkerWaehlen('freies_zeichen-42'));
    expect(result.current.auswahl).toBe('freies_zeichen-42');
    act(() => {
      result.current.zeichenLoeschen(42);
    });
    await waitFor(() => expect(freieZeichenApi.loescheFreiesZeichen).toHaveBeenCalledWith(1, 42));
    // setAuswahl(null) läuft im .then nach erfolgreichem DELETE.
    await waitFor(() => expect(result.current.auswahl).toBeNull());
  });
});

/**
 * Serienmodus: der Platzier-Modus bleibt nach dem Speichern stehen, damit gleichartige Zeichen ohne
 * Umweg folgen.
 */
describe('useKartenInteraktion — Serienmodus freies Zeichen (LFH-332)', () => {
  /**
   * Ein Karten-Klick + Warten auf genau den n-ten POST; `toHaveBeenCalled()` wäre beim zweiten
   * Klick schon durch den ersten erfüllt.
   */
  async function platziere(result: HookResult, lng: number, lat: number, malCount: number) {
    act(() => result.current.onKarteKlick({ lng, lat }));
    await waitFor(() =>
      expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledTimes(malCount),
    );
  }

  it('ist Vorgabe AN', () => {
    const { result } = rendere();
    expect(result.current.zeichenSerie).toBe(true);
  });

  // Der Modus überlebt den erfolgreichen POST, erst „Fertig" beendet ihn.
  it('nach erfolgreichem Speichern bleibt der Platzier-Modus aktiv — erst „Fertig" beendet ihn', async () => {
    freieZeichenApi.legeFreiesZeichenAn.mockClear();
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));

    await platziere(result, 8.6, 50.1, 1);
    await waitFor(() => expect(result.current.zeichenSerieAnzahl).toBe(1));
    // Kern der Sache: der Modus steht noch, samt unveränderter Spec.
    expect(result.current.zeichenPlatzieren).toEqual({ grundzeichen: 'stelle' });

    // … und ein zweiter Karten-Klick legt deshalb ohne Umweg ein zweites Zeichen an.
    await platziere(result, 8.7, 50.2, 2);
    await waitFor(() => expect(result.current.zeichenSerieAnzahl).toBe(2));
    expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledTimes(2);

    act(() => result.current.onZeichenPlatzierenFertig());
    expect(result.current.zeichenPlatzieren).toBeNull();
  });

  // Die Gegenprobe belegt, dass onSuccess den aktuellen Schalterwert liest, nicht den bei Anlage
  // der Mutation.
  it('mit ausgeschalteter Serie endet der Modus nach dem Speichern wie zuvor', async () => {
    freieZeichenApi.legeFreiesZeichenAn.mockClear();
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    act(() => result.current.setZeichenSerie(false));

    await platziere(result, 8.6, 50.1, 1);
    await waitFor(() => expect(result.current.zeichenPlatzieren).toBeNull());
    expect(result.current.zeichenSerieAnzahl).toBe(0);
  });

  it('ein neuer Platzier-Start setzt den Serien-Zähler zurück', async () => {
    freieZeichenApi.legeFreiesZeichenAn.mockClear();
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    await platziere(result, 8.6, 50.1, 1);
    await waitFor(() => expect(result.current.zeichenSerieAnzahl).toBe(1));

    act(() =>
      result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle', label: 'zweite Serie' }),
    );
    expect(result.current.zeichenSerieAnzahl).toBe(0);
  });
});

describe('useKartenInteraktion — Serienmodus Zone (LFH-332)', () => {
  /** Zone-Modus starten, Geometrie abschließen → Phase „bestaetigen". */
  function bisZurBestaetigung(result: HookResult) {
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    act(() => result.current.onZoneGezeichnet(POLYGON));
  }

  it('ist Vorgabe AN', () => {
    const { result } = rendere();
    expect(result.current.zoneSerie).toBe(true);
  });

  // Das Anlegen einer `gefahrengebiet`-Zone legt serverseitig eine neue Gefahrengebiet-Gruppe an.
  // Invalidiert der Klick nur die Zonen, fehlt deren `gefahrengebiet_id` in der veralteten
  // Gebiets-Liste, und die Karte beschriftet „Stufe unbekannt", bis ein fremder Refetch kommt
  // (sichtbar nur bei hängendem Live-Strom).
  it('invalidiert nach dem Anlegen AUCH die Gefahrengebiete, nicht nur die Zonen', async () => {
    lagezonenApi.legeZoneAn.mockClear();
    const client = neuerQueryClient();
    const spion = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () =>
        useKartenInteraktion({
          einsatzId: 1,
          einsatz: undefined,
          darfSchreiben: true,
          waehlbar: [],
          fehler: vi.fn(),
          erfolg: vi.fn(),
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    bisZurBestaetigung(result);
    act(() => result.current.bestaetigungSpeichern());
    await waitFor(() => expect(lagezonenApi.legeZoneAn).toHaveBeenCalledTimes(1));

    const schluessel = () =>
      spion.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    // Vorbedingung: der Spion sieht die Zonen-Invalidierung überhaupt, sonst bewiese die Aussage
    // unten nichts.
    await waitFor(() => expect(schluessel()).toContain(JSON.stringify(einsatzKeys.zonen(1))));
    // Die tragende Aussage.
    await waitFor(() =>
      expect(schluessel()).toContain(JSON.stringify(einsatzKeys.gefahrengebiete(1))),
    );
  });

  it('nach erfolgreichem Speichern ist derselbe Zonen-Typ erneut scharf UND der Nonce gestiegen', async () => {
    lagezonenApi.legeZoneAn.mockClear();
    const erfolg = vi.fn();
    const { result } = rendere(vi.fn(), erfolg);
    bisZurBestaetigung(result);
    const nonceVorher = result.current.zoneZeichnenNonce;

    act(() => result.current.bestaetigungSpeichern());
    await waitFor(() => expect(lagezonenApi.legeZoneAn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.zoneSerieAnzahl).toBe(1));
    expect(erfolg).toHaveBeenCalledWith('Zone angelegt');

    // Erste Hälfte: der Modus steht noch, mit demselben Entwurf und ohne alte Bestätigung.
    expect(result.current.zoneEntwurf).toEqual({
      typ: 'gefahrengebiet',
      modus: 'polygon',
      farbe: undefined,
    });
    expect(result.current.zoneBestaetigung).toBeNull();
    expect(result.current.zoneSpeichern).toBe(false);
    // Zweite Hälfte: der Zonen-Effekt in Kartenflaeche hängt an [zoneZeichnen, zoneZeichnenNonce].
    // Bei Zone→Zone bleibt der Modus gleich, nur der gestiegene Nonce startet ihn neu; sonst wäre
    // der Zeichenmodus tot und die gespeicherte Geometrie bliebe als zweite Kontur liegen.
    expect(result.current.zoneZeichnenNonce).toBeGreaterThan(nonceVorher);

    act(() => result.current.onZoneZeichnenFertig());
    expect(result.current.zoneEntwurf).toBeNull();
  });

  it('mit ausgeschalteter Serie endet der Zonen-Modus nach dem Speichern wie zuvor', async () => {
    lagezonenApi.legeZoneAn.mockClear();
    const { result } = rendere();
    bisZurBestaetigung(result);
    act(() => result.current.setZoneSerie(false));

    act(() => result.current.bestaetigungSpeichern());
    await waitFor(() => expect(lagezonenApi.legeZoneAn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.zoneEntwurf).toBeNull());
    expect(result.current.zoneBestaetigung).toBeNull();
  });

  // Ein gescheiterter POST setzt die Serie nicht fort: der Neustart verwürfe die ungespeicherte
  // Geometrie, als sei nichts passiert.
  it('scheitert das Speichern, endet der Modus und der Fehler wird gemeldet', async () => {
    const fehler = vi.fn();
    lagezonenApi.legeZoneAn.mockClear();
    lagezonenApi.legeZoneAn.mockImplementationOnce(() => Promise.reject(new Error('kaputt')));
    const { result } = rendere(fehler);
    bisZurBestaetigung(result);

    act(() => result.current.bestaetigungSpeichern());
    await waitFor(() => expect(fehler).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.zoneEntwurf).toBeNull());
    expect(result.current.zoneSerieAnzahl).toBe(0);
  });

  it('was während des Speicherns gestartet wurde, überlebt die Auflösung', async () => {
    // Der Reducer-Fall 'zone' ist bedingungslos, anders als 'beenden' mit seiner `arten`-Prüfung.
    // Die Kette wartet auf POST und Invalidierung, die Sidebar bleibt bedienbar. Ohne Schutz
    // überschriebe die späte Auflösung den inzwischen gestarteten Modus mit dem alten Entwurf.
    lagezonenApi.legeZoneAn.mockClear();
    let loese: () => void = () => {};
    lagezonenApi.legeZoneAn.mockImplementationOnce(
      () =>
        new Promise<{ id: number }>((r) => {
          loese = () => r({ id: 9 });
        }),
    );
    const { result } = rendere();
    bisZurBestaetigung(result);

    act(() => result.current.bestaetigungSpeichern());
    await waitFor(() => expect(lagezonenApi.legeZoneAn).toHaveBeenCalledTimes(1));

    // Mittendrin etwas anderes anfangen: ein taktisches Zeichen verlässt den Zonen-Modus ganz.
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    expect(result.current.zeichenPlatzieren).not.toBeNull();

    await act(async () => {
      loese();
    });

    expect(result.current.zeichenPlatzieren).not.toBeNull();
    expect(result.current.zoneEntwurf ?? null).toBeNull();
    expect(result.current.zoneSerieAnzahl).toBe(0);
  });

  it('ein neuer Zonen-Start setzt den Serien-Zähler zurück', async () => {
    lagezonenApi.legeZoneAn.mockClear();
    const { result } = rendere();
    bisZurBestaetigung(result);
    act(() => result.current.bestaetigungSpeichern());
    await waitFor(() => expect(result.current.zoneSerieAnzahl).toBe(1));

    act(() => result.current.onZoneZeichnenStart({ typ: 'absperrgrenze', modus: 'linie' }));
    expect(result.current.zoneSerieAnzahl).toBe(0);
  });
});

describe('useKartenInteraktion — Messen (LFH-616)', () => {
  it('wechselt die Form ohne Umweg über idle und endet nur auf eigenes Beenden', () => {
    const { result } = rendere();
    act(() => result.current.onMessenStart('strecke'));
    act(() => result.current.onMessenStart('flaeche'));
    expect(result.current.messForm).toBe('flaeche');
    // Ein fremdes Beenden (Zeichnen abbrechen) lässt das Messen stehen …
    act(() => result.current.onZeichnenAbbrechen());
    expect(result.current.messForm).toBe('flaeche');
    // … das eigene nicht.
    act(() => result.current.onMessenBeenden());
    expect(result.current.messForm).toBeNull();
    expect(result.current.exklusiverModusAktiv).toBe(false);
  });
});

describe('useKartenInteraktion — Betreuungsstelle (LFH-673)', () => {
  function mitClient() {
    const client = neuerQueryClient();
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    const erfolg = vi.fn();
    const r = renderHook(
      () =>
        useKartenInteraktion({
          einsatzId: 1,
          einsatz: undefined,
          darfSchreiben: true,
          waehlbar: [],
          fehler: vi.fn(),
          erfolg,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    return { ...r, invalidiert, erfolg };
  }

  it('Platzier-Auftrag: Klick PATCHt NUR das Koordinatenpaar und invalidiert die Betreuung', async () => {
    betreuungApi.aendereStelle.mockClear();
    const { result, invalidiert, erfolg } = mitClient();
    act(() => result.current.onPlatzierenStart({ typ: 'betreuungsstelle', id: 4 }));
    act(() => result.current.onKarteKlick({ lng: 8.87, lat: 51.93 }));
    await waitFor(() => expect(betreuungApi.aendereStelle).toHaveBeenCalledTimes(1));
    expect(betreuungApi.aendereStelle).toHaveBeenCalledWith(1, 4, { lat: 51.93, lon: 8.87 });
    await waitFor(() => expect(erfolg).toHaveBeenCalledWith('Objekt verortet'));
    const keys = invalidiert.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['einsatz-betreuung', 1]);
  });

  it('Verortung löschen schickt null/null und invalidiert die Betreuung', async () => {
    betreuungApi.aendereStelle.mockClear();
    const { result, invalidiert } = mitClient();
    act(() =>
      result.current.loescheVerortung({
        schluessel: 'betreuungsstelle-4',
        typ: 'betreuungsstelle',
        id: 4,
        lat: 51.93,
        lon: 8.87,
        label: 'NU Turnhalle Nord',
        farbe: '#000',
      }),
    );
    await waitFor(() => expect(betreuungApi.aendereStelle).toHaveBeenCalledTimes(1));
    expect(betreuungApi.aendereStelle).toHaveBeenCalledWith(1, 4, { lat: null, lon: null });
    await waitFor(() => {
      const keys = invalidiert.mock.calls.map((c) => c[0]?.queryKey);
      expect(keys).toContainEqual(['einsatz-betreuung', 1]);
    });
  });
});

/**
 * Erste Esc-Stufe in der Bestätigungsphase (LFH-712): die ungespeicherte Figur geht weg, der
 * Zeichenmodus bleibt — anders als „Verwerfen", das ihn beendet.
 */
describe('useKartenInteraktion — Rückweg aus der Bestätigung (LFH-712)', () => {
  it('führt zurück in die Zeichenphase desselben Entwurfs, ohne zu speichern', () => {
    lagezonenApi.legeZoneAn.mockClear();
    const { result } = rendere();
    const entwurf = { typ: 'gefahrengebiet' as const, modus: 'polygon' as const };
    act(() => result.current.onZoneZeichnenStart(entwurf));
    act(() => result.current.onZoneGezeichnet(POLYGON));
    const nonceVorher = result.current.zoneZeichnenNonce;

    act(() => result.current.onBestaetigungZurueck());

    expect(result.current.zoneBestaetigung).toBeNull();
    expect(result.current.zoneEntwurf).toEqual(entwurf);
    // Die Nonce erzwingt `starten()` an der Karte — sonst bliebe die fertige Figur stehen.
    expect(result.current.zoneZeichnenNonce).toBe(nonceVorher + 1);
    expect(lagezonenApi.legeZoneAn).not.toHaveBeenCalled();
  });

  it('ist ohne offene Bestätigung wirkungslos', () => {
    const { result } = rendere();
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    const nonceVorher = result.current.zoneZeichnenNonce;
    act(() => result.current.onBestaetigungZurueck());
    expect(result.current.zoneZeichnenNonce).toBe(nonceVorher);
    expect(result.current.zoneEntwurf).not.toBeNull();
  });

  it('behält den Serienzähler (die gespeicherten Zonen bleiben gezählt)', async () => {
    const { result } = rendere();
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    act(() => result.current.onZoneGezeichnet(POLYGON));
    act(() => result.current.bestaetigungSpeichern());
    await waitFor(() => expect(result.current.zoneSerieAnzahl).toBe(1));
    act(() => result.current.onZoneGezeichnet(POLYGON));
    act(() => result.current.onBestaetigungZurueck());
    expect(result.current.zoneSerieAnzahl).toBe(1);
  });
});

/**
 * Quittungen (LFH-710): jede Karten-Mutation meldet erst nach der erfolgreichen Antwort. Je
 * Mutation das Paar: Erfolg → Quittung, Fehlschlag → Fehler und keine Erfolgsquittung.
 */
describe('useKartenInteraktion — Quittungen der Karten-Mutationen (LFH-710)', () => {
  type Ruf = ReturnType<typeof vi.fn>;
  const markerVon = (typ: KarteMarker['typ'], id: number): KarteMarker => ({
    schluessel: `${typ}-${id}`,
    typ,
    id,
    lat: 50.1,
    lon: 8.6,
    label: 'Objekt',
    farbe: '#000',
  });

  // Alle acht Zweige von `loescheVerortung`, je mit der API, die er ruft.
  const ZWEIGE: [KarteMarker['typ'], Ruf][] = [
    ['uhs', einsatzUhsApi.aktualisiereUhs],
    ['schaden', einsatzSchadenApi.aktualisiereSchaden],
    ['einheit', einheitenApi.verorteEinheit],
    ['fahrzeug', einsatzFahrzeugeApi.verorteFahrzeug],
    ['fuehrung', einsatzPersonalApi.verortePerson],
    ['abschnitt', einsatzabschnitteApi.zeichneAbschnitt],
    ['betreuungsstelle', betreuungApi.aendereStelle],
    ['person', einsatzPersonApi.aktualisierePerson],
  ];

  it.each(ZWEIGE)('Verortung löschen (%s): Erfolg → Quittung', async (typ, api) => {
    api.mockClear();
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    act(() => result.current.loescheVerortung(markerVon(typ, 9)));
    await waitFor(() => expect(erfolg).toHaveBeenCalledWith('Verortung gelöscht'));
    expect(api).toHaveBeenCalledTimes(1);
    expect(fehler).not.toHaveBeenCalled();
  });

  it.each(ZWEIGE)('Verortung löschen (%s): Fehlschlag → keine Quittung', async (typ, api) => {
    api.mockRejectedValueOnce(new Error('abgelehnt'));
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    act(() => result.current.loescheVerortung(markerVon(typ, 9)));
    await waitFor(() => expect(fehler).toHaveBeenCalledTimes(1));
    expect(erfolg).not.toHaveBeenCalled();
  });

  // Ändern, Verschieben und Löschen eines freien Zeichens.
  const ZEICHEN: [string, Ruf, (r: HookResult) => Promise<unknown>, string][] = [
    [
      'zeichenAendern',
      freieZeichenApi.aktualisiereFreiesZeichen,
      (r) => r.current.zeichenAendern(42, { grundzeichen: 'stelle' }),
      'Taktisches Zeichen gespeichert',
    ],
    [
      'zeichenVerschieben',
      freieZeichenApi.verschiebeFreiesZeichen,
      (r) => r.current.zeichenVerschieben(42, 3),
      'Taktisches Zeichen verschoben',
    ],
    [
      'zeichenLoeschen',
      freieZeichenApi.loescheFreiesZeichen,
      (r) => r.current.zeichenLoeschen(42),
      'Taktisches Zeichen gelöscht',
    ],
  ];

  it.each(ZEICHEN)('%s: Erfolg → Quittung', async (_name, api, ausloesen, quittung) => {
    api.mockClear();
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    await act(async () => {
      await ausloesen(result);
    });
    expect(api).toHaveBeenCalledTimes(1);
    expect(erfolg).toHaveBeenCalledWith(quittung);
    expect(fehler).not.toHaveBeenCalled();
  });

  it.each(ZEICHEN)('%s: Fehlschlag → keine Quittung', async (_name, api, ausloesen) => {
    api.mockRejectedValueOnce(new Error('abgelehnt'));
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    await act(async () => {
      await ausloesen(result);
    });
    expect(fehler).toHaveBeenCalledTimes(1);
    expect(erfolg).not.toHaveBeenCalled();
  });

  // Symbol-Override an allen vier taktischen Markerarten.
  const SYMBOL: [KarteMarker['typ'], Ruf][] = [
    ['einheit', einheitenApi.verorteEinheit],
    ['fahrzeug', einsatzFahrzeugeApi.verorteFahrzeug],
    ['fuehrung', einsatzPersonalApi.verortePerson],
    ['abschnitt', einsatzabschnitteApi.zeichneAbschnitt],
  ];

  it.each(SYMBOL)('Symbol ändern (%s): Erfolg → Quittung', async (typ, api) => {
    api.mockClear();
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    act(() => result.current.aendereSymbol(markerVon(typ, 9), { tz_fachaufgabe: 'betreuung' }));
    await waitFor(() => expect(erfolg).toHaveBeenCalledWith('Symbol gespeichert'));
    expect(api).toHaveBeenCalledWith(1, 9, { tz_fachaufgabe: 'betreuung' });
    expect(fehler).not.toHaveBeenCalled();
  });

  it.each(SYMBOL)('Symbol ändern (%s): Fehlschlag → keine Quittung', async (typ, api) => {
    api.mockRejectedValueOnce(new Error('abgelehnt'));
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    act(() => result.current.aendereSymbol(markerVon(typ, 9), { tz_organisation: null }));
    await waitFor(() => expect(fehler).toHaveBeenCalledTimes(1));
    expect(erfolg).not.toHaveBeenCalled();
  });

  const POLY: GeoJsonPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [8, 50],
        [8.1, 50],
        [8.1, 50.1],
        [8, 50],
      ],
    ],
  };

  it('Abschnittsfläche speichern: Erfolg → Quittung, der Zeichenmodus endet', async () => {
    einsatzabschnitteApi.zeichneAbschnitt.mockClear();
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    act(() => result.current.onAbschnittZeichnenStart(8));
    act(() => result.current.onFlaecheGezeichnet(POLY));
    await waitFor(() => expect(erfolg).toHaveBeenCalledWith('Fläche gespeichert'));
    expect(einsatzabschnitteApi.zeichneAbschnitt).toHaveBeenCalledWith(1, 8, {
      flaeche_geojson: JSON.stringify(POLY),
    });
    expect(fehler).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.zeichneAbschnittId).toBeNull());
  });

  it('Abschnittsfläche speichern: Fehlschlag → keine Quittung, der Zeichenmodus endet', async () => {
    einsatzabschnitteApi.zeichneAbschnitt.mockRejectedValueOnce(new Error('abgelehnt'));
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    act(() => result.current.onAbschnittZeichnenStart(8));
    act(() => result.current.onFlaecheGezeichnet(POLY));
    await waitFor(() => expect(fehler).toHaveBeenCalledTimes(1));
    expect(erfolg).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.zeichneAbschnittId).toBeNull());
  });

  it('zoneLoeschen: Fehlschlag → keine Quittung', async () => {
    lagezonenApi.loescheZone.mockRejectedValueOnce(new Error('abgelehnt'));
    const fehler = vi.fn();
    const erfolg = vi.fn();
    const { result } = rendere(fehler, erfolg);
    await act(async () => {
      await result.current.zoneLoeschen(5);
    });
    expect(fehler).toHaveBeenCalledTimes(1);
    expect(erfolg).not.toHaveBeenCalled();
  });
});
