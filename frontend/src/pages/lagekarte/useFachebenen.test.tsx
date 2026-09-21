import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { neuerQueryClient } from '../../test/utils';
import {
  ladeFachebene,
  type FachebeneAntwort,
  type FachebeneQuelle,
  type FeatureCollection,
} from '../../api/fachebenen';
import { useFachebenen } from './useFachebenen';
import { FACHEBENEN } from './fachebenen';
import { defaultFachebenenSichtbar, type FachebenenSichtbar } from './fachebenenAuswahl';
import { hochwasserRadius } from './hochwasserStil';
import { luftqualitaetRadius } from './luftqualitaetStil';
import { odlRadius } from './odlStil';

// Fixtures via vi.hoisted, damit sowohl die (hochgezogene) vi.mock-Factory als auch
// die Assertions dieselben Feature-Sammlungen sehen.
const fx = vi.hoisted(() => {
  const fc = (coords: number[][]): FeatureCollection => ({
    type: 'FeatureCollection',
    features: coords.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: {},
    })),
  });
  // Zwei Pegel mit verschiedener Meldeklasse — die Ebene muss sie unterscheidbar machen.
  const hochwasser: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [8, 50] },
        properties: { titel: 'Alarmpegel', klasse: 'gross' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [9, 51] },
        properties: { titel: 'Ruhiger Pegel', klasse: 'kein_hochwasser' },
      },
    ],
  };
  // VIER Stationen: die Menge unterscheidet auch diese Ebene von jeder anderen Fixture.
  const luftqualitaet: FeatureCollection = {
    type: 'FeatureCollection',
    features: (
      [
        ['sehr_schlecht', [13.06, 52.39]],
        ['sehr_gut', [8.21, 53.14]],
        ['gut', [7.1, 50.7]],
        ['maessig', [11.5, 48.1]],
      ] as const
    ).map(([klasse, c]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [...c] },
      properties: { titel: `Station ${klasse}`, klasse },
    })),
  };
  // VIER Sonden — keine andere Fixture hat vier Features, ein vertauschter `combine`-Index
  // fiele an der Menge auf. Eine davon stark erhöht, eine ohne Messung.
  const odl: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      ['Chemnitz', 'stark_erhoeht', [12.87, 50.79]],
      ['Flensburg', 'normal', [9.43, 54.78]],
      ['Bechhofen', 'keine_messung', [10.63, 49.18]],
      ['Görlitz', 'erhoeht', [14.99, 51.15]],
    ].map(([titel, stufe, c]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: { titel, stufe },
    })),
  };
  return {
    fc,
    luftqualitaet,
    // Umschaltbar je Test: der Status steuert, ob die Attribution erscheint.
    lqStatus: 'ok' as FachebeneAntwort['status'],
    odl,
    nina: fc([[9, 50]]),
    kritisA: fc([[10, 51]]),
    kritisB: fc([[11, 52]]),
    hochwasser,
    // Bewusst DREI Punkte: die Menge unterscheidet die Autobahn-Ebene von jeder anderen
    // Fixture — ein vertauschter `combine`-Index fiele sonst nicht auf.
    autobahn: fc([
      [6.86, 50.98],
      [7.67, 51.57],
      [6.96, 49.27],
    ]),
    // Energie (LFH-81): VIER Punkte im ersten, ein weiterer im zweiten Ausschnitt — die
    // Mengen unterscheiden sich von jeder anderen Fixture (KRITIS 1, Autobahn 3), ein
    // vertauschter `combine`-Index fiele also auf.
    energieA: fc([
      [7.05, 51.6],
      [7.21, 51.53],
      [7.19, 51.54],
      [7.3, 51.5],
    ]),
    energieB: fc([[7.4, 51.45]]),
    // Quellennennung (LFH-81): ein Ausschnitt mit MaStR-Anteil, einer mit reinem OSM.
    energieMastr: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [7.6, 51.2] },
          properties: { herkunft: 'mastr', mastr_nummer: 'SEE1' },
        },
      ],
    } as FeatureCollection,
    energieOsm: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [8.6, 52.2] },
          properties: { herkunft: 'osm' },
        },
      ],
    } as FeatureCollection,
  };
});

vi.mock('../../api/fachebenen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/fachebenen')>();
  return {
    ...actual,
    ladeFachebene: vi.fn((quelle: FachebeneQuelle, bbox?: string): Promise<FachebeneAntwort> => {
      if (quelle === 'nina')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: '© NINA',
          stand: null,
          features: fx.nina,
        });
      if (quelle === 'autobahn')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: 'Autobahn GmbH des Bundes',
          stand: null,
          features: fx.autobahn,
        });
      if (quelle === 'luftqualitaet')
        return Promise.resolve({
          quelle,
          status: fx.lqStatus,
          attribution: 'Umweltbundesamt',
          stand: '2026-09-21T09:00:00+01:00',
          features: fx.lqStatus === 'offline' ? fx.fc([]) : fx.luftqualitaet,
        });
      if (quelle === 'odl')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: 'Bundesamt für Strahlenschutz (BfS), dl-de/by-2-0',
          stand: null,
          features: fx.odl,
        });
      if (quelle === 'hochwasser')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: '© LHP',
          stand: null,
          features: fx.hochwasser,
        });
      if (quelle === 'energie' && bbox === 'bbox-mastr')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution:
            '© OpenStreetMap-Beitragende (ODbL) · Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0',
          stand: null,
          features: fx.energieMastr,
        });
      if (quelle === 'energie' && (bbox === 'bbox-osm' || bbox === 'bbox-osm2'))
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: '© OpenStreetMap-Beitragende (ODbL)',
          stand: null,
          features: fx.energieOsm,
        });
      if (quelle === 'kritis')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: '© KRITIS',
          stand: null,
          features: bbox === 'bbox2' ? fx.kritisB : fx.kritisA,
        });
      if (quelle === 'energie')
        return Promise.resolve({
          quelle,
          status: 'ok',
          attribution: '© OpenStreetMap-Beitragende (ODbL)',
          stand: null,
          features: bbox === 'bbox2' ? fx.energieB : fx.energieA,
        });
      return Promise.resolve({
        quelle,
        status: 'leer',
        attribution: '',
        stand: null,
        features: fx.fc([]),
      });
    }),
  };
});

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Sichtbarkeit ist seit LFH-319 externer State (useKartenAnsicht); im Test hält ihn ein
// kontrollierter useState, damit onFachebeneToggle → setFachebenenSichtbar den Hook re-rendert.
function rendere() {
  return renderHook(
    () => {
      const [sichtbar, setSichtbar] = useState<FachebenenSichtbar>(defaultFachebenenSichtbar);
      return useFachebenen({ fachebenenSichtbar: sichtbar, setFachebenenSichtbar: setSichtbar });
    },
    { wrapper: wrapper() },
  );
}

describe('useFachebenen', () => {
  // Der Luftqualitäts-Status ist modulweit veränderlich; ein vorzeitig scheiternder Test darf
  // `offline` nicht an den nächsten weitergeben.
  afterEach(() => {
    fx.lqStatus = 'ok';
  });

  it('startet mit allen Ebenen aus (keine Queries, keine Attribution)', () => {
    const { result } = rendere();
    expect(result.current.aktiveFachebenen).toHaveLength(0);
    expect(result.current.fachebenenAttribution).toHaveLength(0);
  });

  it('aktiviert nina → Layer-Daten, Status und Attribution aus der Query', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('nina', true));
    // Auf die geladenen Daten warten, nicht bloß auf die Sichtbarkeit (sonst Race: der
    // Layer erscheint mit leerer FeatureCollection, bevor die Query aufgelöst ist).
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'nina')?.daten.features,
      ).toHaveLength(1),
    );
    const nina = result.current.aktiveFachebenen.find((f) => f.def.key === 'nina');
    expect(nina?.daten.features).toHaveLength(1);
    expect(result.current.fachebenenStatus.nina).toBe('ok');
    expect(result.current.fachebenenAttribution).toContain('© NINA');
  });

  it('ersetzt KRITIS bei einem bbox-Wechsel, statt zu akkumulieren (LFH-83)', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('kritis', true));
    act(() => result.current.setViewportBbox('bbox1'));
    const kritis = () => result.current.aktiveFachebenen.find((f) => f.def.key === 'kritis');
    await waitFor(() =>
      expect(kritis()?.daten.features[0]?.geometry?.coordinates).toEqual([10, 51]),
    );
    act(() => result.current.setViewportBbox('bbox2'));
    // Der Server liefert je Ausschnitt den vollständigen Bestand bzw. dessen Sammelpunkte.
    // Akkumulierte die Ebene weiter, lägen nach dem Herauszoomen Einzelobjekte UND die
    // Sammelpunkte derselben Gegend übereinander — und die Bündelzahl zählte doppelt.
    await waitFor(() =>
      expect(kritis()?.daten.features[0]?.geometry?.coordinates).toEqual([11, 52]),
    );
    expect(kritis()?.daten.features).toHaveLength(1);
  });

  it('hält beim bbox-Wechsel die bisherigen KRITIS-Daten, bis die neuen da sind (LFH-83)', async () => {
    const lade = vi.mocked(ladeFachebene);
    const original = lade.getMockImplementation()!;
    let freigeben: () => void = () => {};
    lade.mockImplementation((quelle, bbox) => {
      if (quelle !== 'kritis' || bbox !== 'bbox2') return original(quelle, bbox);
      return new Promise((ok) => {
        freigeben = () => void original(quelle, bbox).then(ok);
      });
    });
    try {
      const { result } = rendere();
      const kritis = () => result.current.aktiveFachebenen.find((f) => f.def.key === 'kritis');
      act(() => result.current.onFachebeneToggle('kritis', true));
      act(() => result.current.setViewportBbox('bbox1'));
      await waitFor(() => expect(kritis()?.daten.features).toHaveLength(1));
      act(() => result.current.setViewportBbox('bbox2'));
      await waitFor(() => expect(result.current.fachebenenLaedt.kritis).toBe(true));
      // Während die neue bbox lädt: kein Leer-Blinken, das alte Bild steht.
      expect(kritis()?.daten.features[0]?.geometry?.coordinates).toEqual([10, 51]);
      act(() => freigeben());
      await waitFor(() =>
        expect(kritis()?.daten.features[0]?.geometry?.coordinates).toEqual([11, 52]),
      );
    } finally {
      lade.mockImplementation(original);
    }
  });

  it('fragt KRITIS im Aufwärm-Takt nach, solange der Bestand offline ist (LFH-83)', async () => {
    const lade = vi.mocked(ladeFachebene);
    const original = lade.getMockImplementation()!;
    let rufe = 0;
    lade.mockImplementation((quelle, bbox) => {
      if (quelle !== 'kritis') return original(quelle, bbox);
      rufe += 1;
      return Promise.resolve({
        quelle,
        status: 'offline',
        attribution: '© OpenStreetMap-Beitragende (ODbL)',
        stand: null,
        features: fx.fc([]),
      });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = rendere();
      act(() => result.current.onFachebeneToggle('kritis', true));
      act(() => result.current.setViewportBbox('bbox1'));
      await waitFor(() => expect(result.current.fachebenenStatus.kritis).toBe('offline'));
      const nachErstemRuf = rufe;
      // Ohne Kartenbewegung: der erste Bestand muss trotzdem erscheinen (Spec „Erster Start").
      await act(() => vi.advanceTimersByTimeAsync(FACHEBENEN.kritis.aufwaermPollMs! + 1_000));
      expect(rufe).toBeGreaterThan(nachErstemRuf);
    } finally {
      vi.useRealTimers();
      lade.mockImplementation(original);
    }
  });

  it('pollt KRITIS nicht, sobald ein Bestand da ist (LFH-83)', async () => {
    const lade = vi.mocked(ladeFachebene);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = rendere();
      act(() => result.current.onFachebeneToggle('kritis', true));
      act(() => result.current.setViewportBbox('bbox1'));
      await waitFor(() => expect(result.current.fachebenenStatus.kritis).toBe('ok'));
      const kritisRufe = () => lade.mock.calls.filter(([q]) => q === 'kritis').length;
      const vorher = kritisRufe();
      // Gegenstück zur Aufwärmphase: mit Bestand ist die Ebene bbox-getrieben.
      await act(() => vi.advanceTimersByTimeAsync(FACHEBENEN.kritis.aufwaermPollMs! * 3));
      expect(kritisRufe()).toBe(vorher);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hält die aktiveFachebenen-Referenz über ein No-op-Re-Render stabil (combine-Memoisierung)', async () => {
    const { result, rerender } = rendere();
    act(() => result.current.onFachebeneToggle('nina', true));
    // Erst wenn die Daten geladen sind (kein Pending mehr), ist die combine-Ausgabe stabil.
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'nina')?.daten.features,
      ).toHaveLength(1),
    );
    const vorher = result.current.aktiveFachebenen;
    rerender();
    // replaceEqualDeep in query-core → identische Referenz bei unveränderten Daten,
    // sonst würde der Kartenflaeche-fachebenen-Effekt pro Frame neu feuern.
    expect(result.current.aktiveFachebenen).toBe(vorher);
  });

  it('färbt und staffelt die Hochwasserpegel nach ihrer Meldeklasse (LFH-77)', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('hochwasser', true));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'hochwasser')?.daten.features,
      ).toHaveLength(2),
    );
    const features = result.current.aktiveFachebenen.find((f) => f.def.key === 'hochwasser')!.daten
      .features;
    const [alarm, ruhig] = features;
    // Ohne diesen Schritt kämen die Rohdaten durch und die Karte zeichnete 2000 gleich
    // große Punkte in der Ebenenfarbe — die Meldeklasse wäre unsichtbar.
    expect(alarm.properties.radius).toBe(hochwasserRadius('gross'));
    expect(ruhig.properties.radius).toBe(hochwasserRadius('kein_hochwasser'));
    expect(alarm.properties.farbe).not.toBe(ruhig.properties.farbe);
    // Die Bestandsproperties überleben die Einfärbung (der Inspector liest `titel`).
    expect(alarm.properties.titel).toBe('Alarmpegel');
  });

  it('färbt und staffelt die ODL-Sonden nach ihrer Stufe, mit BfS-Attribution (LFH-78)', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('odl', true));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'odl')?.daten.features,
      ).toHaveLength(4),
    );
    const [stark, normal, ohne, erhoeht] = result.current.aktiveFachebenen.find(
      (f) => f.def.key === 'odl',
    )!.daten.features;
    // Positionsweise Zuordnung in `combine`: gegen die konkrete Koordinate prüfen.
    expect(stark.geometry?.coordinates).toEqual([12.87, 50.79]);
    expect(stark.properties.radius).toBe(odlRadius('stark_erhoeht'));
    expect(erhoeht.properties.radius).toBe(odlRadius('erhoeht'));
    expect(normal.properties.radius).toBe(odlRadius('normal'));
    expect(ohne.properties.radius).toBe(odlRadius('keine_messung'));
    expect(stark.properties.farbe).not.toBe(normal.properties.farbe);
    expect(stark.properties.titel).toBe('Chemnitz');
    expect(result.current.fachebenenStatus.odl).toBe('ok');
    // Spec „Quellennennung".
    // Das Ergebnis ist ein ARRAY ganzer Attributionstexte — `toContain` auf dem Array prüfte
    // Gleichheit eines Elements, nicht einen Teilstring. Deshalb über den verbundenen Text.
    expect(result.current.fachebenenAttribution.join(' | ')).toContain(
      'Bundesamt für Strahlenschutz (BfS)',
    );
  });

  it('nennt die BfS-Quelle nicht, solange die ODL-Ebene offline ist (LFH-78)', async () => {
    vi.mocked(ladeFachebene).mockImplementationOnce((quelle) =>
      Promise.resolve({
        quelle,
        status: 'offline',
        attribution: 'Bundesamt für Strahlenschutz (BfS), dl-de/by-2-0',
        stand: null,
        features: fx.fc([]),
      }),
    );
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('odl', true));
    await waitFor(() => expect(result.current.fachebenenStatus.odl).toBe('offline'));
    // Über den verbundenen Text: auf dem Array wäre `not.toContain('Strahlenschutz')` IMMER
    // grün, weil kein Element exakt so lautet — ein Test, der nicht rot werden kann.
    expect(result.current.fachebenenAttribution.join(' | ')).not.toContain('Strahlenschutz');
  });

  it('lässt die übrigen Ebenen unangetastet — nur Hochwasser wird eingefärbt', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('nina', true));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'nina')?.daten.features,
      ).toHaveLength(1),
    );
    const nina = result.current.aktiveFachebenen.find((f) => f.def.key === 'nina')!.daten
      .features[0];
    expect(nina.properties.farbe).toBeUndefined();
    expect(nina.properties.radius).toBeUndefined();
  });

  it('aktiviert autobahn → eigene Daten und Pflicht-Attribution (LFH-80)', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('autobahn', true));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'autobahn')?.daten.features,
      ).toHaveLength(3),
    );
    // Die Zuordnung Query→Ebene läuft in `combine` über POSITIONEN. Ein verschobener Index
    // wäre kein Fehler, sondern eine stille Verwechslung: die Ebene zeigte fremde Daten.
    // Deshalb gegen die konkrete Koordinate prüfen, nicht bloß gegen die Anzahl.
    const ab = result.current.aktiveFachebenen.find((f) => f.def.key === 'autobahn');
    expect(ab?.daten.features[0].geometry?.coordinates).toEqual([6.86, 50.98]);
    expect(result.current.fachebenenStatus.autobahn).toBe('ok');
    // AK „Quellennennung korrekt".
    expect(result.current.fachebenenAttribution).toContain('Autobahn GmbH des Bundes');
  });

  it('färbt und staffelt die Luftmessstationen nach ihrer Indexstufe (LFH-79)', async () => {
    fx.lqStatus = 'ok';
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('luftqualitaet', true));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'luftqualitaet')?.daten.features,
      ).toHaveLength(4),
    );
    const [schlecht, sehrGut, gut] = result.current.aktiveFachebenen.find(
      (f) => f.def.key === 'luftqualitaet',
    )!.daten.features;
    // Koordinate statt Anzahl: die Zuordnung Query→Ebene läuft über Positionen.
    expect(schlecht.geometry?.coordinates).toEqual([13.06, 52.39]);
    expect(schlecht.properties.radius).toBe(luftqualitaetRadius('sehr_schlecht'));
    expect(schlecht.properties.farbe).not.toBe(sehrGut.properties.farbe);
    // Zwei Stufen, eine Rolle: gleiche Farbe, verschiedene Größe — der zweite Kanal.
    expect(sehrGut.properties.farbe).toBe(gut.properties.farbe);
    expect(sehrGut.properties.radius).not.toBe(gut.properties.radius);
    expect(schlecht.properties.titel).toBe('Station sehr_schlecht');
  });

  it('verschiebt mit der siebten Query keine Bestandsebene (LFH-79)', async () => {
    // `combine` greift positionsweise ab. Stünde die neue Query nicht am ENDE des Tupels,
    // trügen Autobahn oder KRITIS still die Daten einer Nachbarebene.
    fx.lqStatus = 'ok';
    const { result } = rendere();
    act(() => {
      result.current.onFachebeneToggle('luftqualitaet', true);
      result.current.onFachebeneToggle('autobahn', true);
      result.current.onFachebeneToggle('kritis', true);
      result.current.setViewportBbox('bbox1');
    });
    const daten = (k: string) =>
      result.current.aktiveFachebenen.find((f) => f.def.key === k)?.daten.features;
    await waitFor(() => {
      expect(daten('luftqualitaet')).toHaveLength(4);
      expect(daten('autobahn')).toHaveLength(3);
      expect(daten('kritis')).toHaveLength(1);
    });
    expect(daten('autobahn')![0].geometry?.coordinates).toEqual([6.86, 50.98]);
    expect(daten('kritis')![0].geometry?.coordinates).toEqual([10, 51]);
    expect(daten('luftqualitaet')![0].geometry?.coordinates).toEqual([13.06, 52.39]);
  });

  it('nennt das Umweltbundesamt, solange die Ebene nicht offline ist (LFH-79)', async () => {
    fx.lqStatus = 'ok';
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('luftqualitaet', true));
    await waitFor(() => expect(result.current.fachebenenStatus.luftqualitaet).toBe('ok'));
    expect(result.current.fachebenenAttribution).toContain('Umweltbundesamt');
  });

  it('blendet die Attribution einer offline gemeldeten Luftqualitätsebene aus (LFH-79)', async () => {
    fx.lqStatus = 'offline';
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('luftqualitaet', true));
    await waitFor(() => expect(result.current.fachebenenStatus.luftqualitaet).toBe('offline'));
    expect(result.current.fachebenenAttribution).not.toContain('Umweltbundesamt');
  });

  it('autobahn braucht keine bbox — sie lädt schon durch das Einschalten (LFH-80)', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('autobahn', true));
    // Gegenstück zu KRITIS, das ohne `setViewportBbox` dauerhaft leer bliebe. Geriete die
    // Autobahn-Ebene in den bbox-Zweig, stünde hier 0 statt 3.
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'autobahn')?.daten.features,
      ).toHaveLength(3),
    );
    expect(result.current.aktiveFachebenen.find((f) => f.def.key === 'kritis')).toBeUndefined();
  });

  it('fällt nach einem gescheiterten Refetch auf den Aufwärm-Takt zurück (LFH-80)', async () => {
    const lade = vi.mocked(ladeFachebene);
    const original = lade.getMockImplementation()!;
    let rufe = 0;
    lade.mockImplementation((quelle, bbox) => {
      if (quelle !== 'autobahn') return original(quelle, bbox);
      rufe += 1;
      // Erster Lauf trägt, jeder weitere scheitert — der Fall „Backend kurz weg".
      return rufe === 1 ? original(quelle, bbox) : Promise.reject(new Error('Netz weg'));
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = rendere();
      act(() => result.current.onFachebeneToggle('autobahn', true));
      await waitFor(() => expect(result.current.fachebenenStatus.autobahn).toBe('ok'));

      // Nach dem Erfolg läuft der reguläre Takt; der Lauf danach scheitert.
      await act(() => vi.advanceTimersByTimeAsync(FACHEBENEN.autobahn.pollMs + 1_000));
      await waitFor(() => expect(result.current.fachebenenStatus.autobahn).toBe('offline'));
      const nachFehlschlag = rufe;

      // Die tragende Aussage: react-query HÄLT nach einem gescheiterten Refetch die
      // vorigen `data` — ohne `isError` in der Takt-Ableitung stünde dort weiter `ok`,
      // die Ebene bliebe auf 600 s und zeigte zehn Minuten lang nichts, obwohl das
      // Backend längst wieder da wäre. Hier muss innerhalb des Aufwärm-Takts ein
      // weiterer Versuch laufen.
      await act(() => vi.advanceTimersByTimeAsync(FACHEBENEN.autobahn.aufwaermPollMs! + 1_000));
      expect(rufe).toBeGreaterThan(nachFehlschlag);
    } finally {
      vi.useRealTimers();
      lade.mockImplementation(original);
    }
  });

  it('meldet für KRITIS in keiner Zoomstufe einen Zoom-Hinweis (LFH-83)', () => {
    // KRITIS fragt seit LFH-83 in JEDER Zoomstufe den Extrakt-Bestand (gebündelt ab 5000
    // Objekten) — anders als vor LFH-81/83, als dieselbe `BBOX_MIN_ZOOM`-Schwelle noch für
    // alle bbox-abhängigen Ebenen galt. Die Schwelle gilt seither nur für Ebenen mit eigenem
    // `minZoom` in der Registry, und KRITIS trägt keinen.
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('kritis', true));
    act(() => result.current.setKartenZoom(5));
    expect(result.current.zoomZuKlein.kritis).toBeFalsy();
    act(() => result.current.setKartenZoom(12));
    expect(result.current.zoomZuKlein.kritis).toBeFalsy();
  });

  it('meldet den Zoom-Hinweis auch für die Energieanlagen, KRITIS bleibt aus (LFH-81)', () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setKartenZoom(9));
    expect(result.current.zoomZuKlein.energie).toBe(true);
    // Der Hinweis hängt an der sichtbaren Ebene, nicht an KRITIS.
    expect(result.current.zoomZuKlein.kritis).toBeFalsy();
    act(() => result.current.setKartenZoom(10));
    expect(result.current.zoomZuKlein.energie).toBe(false);
  });

  it('eine Ebene ohne bbox bekommt keinen Zoom-Hinweis', () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('autobahn', true));
    act(() => result.current.setKartenZoom(5));
    expect(result.current.zoomZuKlein.autobahn).toBeFalsy();
  });

  it('fragt die Energieanlagen mit der bbox ab und akkumuliert sie (LFH-81)', async () => {
    const lade = vi.mocked(ladeFachebene);
    lade.mockClear();
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setKartenZoom(10));
    // Ohne bbox keine Abfrage — die Ebene ist bbox-abhängig wie KRITIS.
    expect(lade.mock.calls.filter(([q]) => q === 'energie')).toHaveLength(0);
    act(() => result.current.setViewportBbox('bbox1'));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'energie')?.daten.features,
      ).toHaveLength(4),
    );
    expect(lade).toHaveBeenCalledWith('energie', 'bbox1');
    // Gegen die konkrete Koordinate, nicht bloß die Anzahl (Index-Verwechslung in `combine`).
    const energie = result.current.aktiveFachebenen.find((f) => f.def.key === 'energie');
    expect(energie?.daten.features[0].geometry?.coordinates).toEqual([7.05, 51.6]);
    expect(result.current.fachebenenStatus.energie).toBe('ok');
    expect(result.current.fachebenenAttribution).toContain('© OpenStreetMap-Beitragende (ODbL)');

    act(() => result.current.setViewportBbox('bbox2'));
    // Der neue Ausschnitt kommt dazu, der alte bleibt stehen (Energie akkumuliert — anders
    // als KRITIS, dessen bbox-Antwort das Bild ersetzt, s. o.).
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'energie')?.daten.features,
      ).toHaveLength(5),
    );
    // KRITIS ist aus und wurde nie abgefragt — der Ausschnitt gehört nicht mehr KRITIS allein.
    expect(lade.mock.calls.filter(([q]) => q === 'kritis')).toHaveLength(0);
  });

  it('teilt den Ausschnitt zwischen KRITIS und Energie, die Sammlungen bleiben getrennt', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('kritis', true));
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setKartenZoom(10));
    act(() => result.current.setViewportBbox('bbox1'));
    await waitFor(() => {
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'energie')?.daten.features,
      ).toHaveLength(4);
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'kritis')?.daten.features,
      ).toHaveLength(1);
    });
    const kritis = result.current.aktiveFachebenen.find((f) => f.def.key === 'kritis');
    expect(kritis?.daten.features[0].geometry?.coordinates).toEqual([10, 51]);
  });

  it('fragt die Energieanlagen unter dem Mindest-Zoom nicht ab, auch mit bbox (LFH-81)', async () => {
    // Seit LFH-83 meldet die Karte den Ausschnitt in JEDER Zoomstufe (KRITIS braucht ihn
    // dort). Die Energie-Ebene fragt Overpass live und braucht deshalb weiterhin ihren
    // eigenen Mindest-Zoom — das Gate sitzt im Hook, nicht mehr an der Karte.
    const lade = vi.mocked(ladeFachebene);
    lade.mockClear();
    const { result } = rendere();
    const energieRufe = () => lade.mock.calls.filter(([q]) => q === 'energie');
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setKartenZoom(9));
    act(() => result.current.setViewportBbox('7.01,51.51,7.12,51.58'));
    // Ein Zyklus Zeit, damit eine fälschlich aktivierte Query hier auch wirklich feuerte.
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(energieRufe()).toHaveLength(0);
    expect(result.current.zoomZuKlein.energie).toBe(true);
    // Gegenaussage: ab Zoom 10 geht dieselbe (einzige, geteilte) bbox unverändert raus.
    act(() => result.current.setKartenZoom(10));
    await waitFor(() => expect(energieRufe()).toHaveLength(1));
    expect(energieRufe()[0][1]).toBe('7.01,51.51,7.12,51.58');
  });

  it('fragt Energie auf breitem Schirm ab Zoom 10 ab, bremst aber einen zu großen Ausschnitt (LFH-81)', async () => {
    // Bei Zoom 10 ist ein Grad rund 1456 px breit — ab etwa 1920 px Bildschirm war der
    // Ausschnitt größer als die frühere 1°-Grenze, und die Ebene stand leer auf „offline".
    const lade = vi.mocked(ladeFachebene);
    lade.mockClear();
    const { result } = rendere();
    const energieRufe = () => lade.mock.calls.filter(([q]) => q === 'energie');
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setKartenZoom(10));
    // 3,6° breit: über der Grenze → keine Abfrage, dafür der Hinweis.
    act(() => result.current.setViewportBbox('5.0,50.0,8.6,51.0'));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(energieRufe()).toHaveLength(0);
    expect(result.current.zoomZuKlein.energie).toBe(true);
    // 1,6° breit (1920-px-Schirm bei Zoom 10): geht raus, kein Hinweis.
    act(() => result.current.setViewportBbox('6.2,51.2,7.8,51.8'));
    await waitFor(() => expect(energieRufe()).toHaveLength(1));
    expect(result.current.zoomZuKlein.energie).toBe(false);
  });

  it('ein Ausschnitt ohne gemeldeten Zoom schaltet die Energie-Abfrage nicht frei', async () => {
    const lade = vi.mocked(ladeFachebene);
    lade.mockClear();
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setViewportBbox('bbox1'));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(lade.mock.calls.filter(([q]) => q === 'energie')).toHaveLength(0);
  });

  it('hält die aktiveFachebenen-Referenz auch mit aktiver Energie-Ebene stabil', async () => {
    const { result, rerender } = rendere();
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setKartenZoom(10));
    act(() => result.current.setViewportBbox('bbox1'));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'energie')?.daten.features,
      ).toHaveLength(4),
    );
    const vorher = result.current.aktiveFachebenen;
    rerender();
    expect(result.current.aktiveFachebenen).toBe(vorher);
  });
  it('behält die MaStR-Nennung nach dem Pannen in reines OSM-Gebiet (LFH-81)', async () => {
    const MASTR = 'Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0';
    const OSM = '© OpenStreetMap-Beitragende (ODbL)';
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setKartenZoom(10));
    act(() => result.current.setViewportBbox('bbox-mastr'));
    await waitFor(() => expect(result.current.fachebenenAttribution.join(' · ')).toContain(MASTR));

    // Die letzte Antwort nennt nur noch OSM — gezeichnet werden aber weiter die gesammelten
    // MaStR-Punkte, und die tragen die Lizenzpflicht mit.
    act(() => result.current.setViewportBbox('bbox-osm'));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'energie')?.daten.features,
      ).toHaveLength(2),
    );
    const zeile = result.current.fachebenenAttribution.join(' · ');
    expect(zeile).toContain(MASTR);
    expect(zeile).toContain(OSM);
  });

  it('nennt MaStR nicht, solange kein MaStR-Punkt gesammelt ist (LFH-81)', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('energie', true));
    act(() => result.current.setKartenZoom(10));
    act(() => result.current.setViewportBbox('bbox-osm'));
    await waitFor(() =>
      expect(
        result.current.aktiveFachebenen.find((f) => f.def.key === 'energie')?.daten.features,
      ).toHaveLength(1),
    );
    const zeile = result.current.fachebenenAttribution.join(' · ');
    expect(zeile).toContain('© OpenStreetMap-Beitragende (ODbL)');
    expect(zeile).not.toContain('Marktstammdatenregister');
  });

  it('die KRITIS-Nennung bleibt die der Antwort (LFH-81)', async () => {
    const { result } = rendere();
    act(() => result.current.onFachebeneToggle('kritis', true));
    act(() => result.current.setViewportBbox('bbox1'));
    await waitFor(() => expect(result.current.fachebenenAttribution).toEqual(['© KRITIS']));
  });
});
