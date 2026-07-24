import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import type { FreiesZeichenUpdate } from '../../api/types';
import type { GeoJsonGeometry } from './geo';
import { useKartenInteraktion } from './useKartenInteraktion';

// API-Client der freien Zeichen mocken (LFH-170 Etappe 3): der Hook ruft ihn bei Platzieren/
// Ändern/Löschen; hier nur die Aufrufe prüfen (kein Netz).
const freieZeichenApi = vi.hoisted(() => ({
  legeFreiesZeichenAn: vi.fn(() => Promise.resolve({ id: 42 })),
  aktualisiereFreiesZeichen: vi.fn(() => Promise.resolve({ id: 42 })),
  loescheFreiesZeichen: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../api/freieZeichen', () => freieZeichenApi);

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function rendere() {
  return renderHook(
    () =>
      useKartenInteraktion({
        einsatzId: 1,
        einsatz: undefined,
        darfSchreiben: true,
        alleVerortet: [],
        fehler: vi.fn(),
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

// Jeder wechselseitig-exklusive Interaktionsmodus samt seiner Start-Sequenz.
// Während eines dieser Modi darf ein Karten-Klick auf ein bestehendes Objekt kein
// Auswahl-Panel öffnen (LFH-208: sonst Doppel-Panel neben der ZeichnenSteuerung).
// `familie` = die Modus-Identität: zone-zeichnen und zone-bestaetigung sind zwei Phasen
// DESSELBEN Modus (der Entwurf bleibt während der Bestätigung stehen) und dürfen daher
// koexistieren. Zwei verschiedene Familien gleichzeitig sind dagegen immer ein Defekt.
const MODI: { name: string; familie: string; betreten: (r: HookResult) => void }[] = [
  { name: 'platzieren', familie: 'platzieren', betreten: (r) => act(() => r.current.onPlatzierenStart({ typ: 'uhs', id: 2 })) },
  { name: 'bild-platzieren', familie: 'bild', betreten: (r) => act(() => r.current.onBildPlatzieren(7)) },
  { name: 'abschnitt-zeichnen', familie: 'abschnitt', betreten: (r) => act(() => r.current.onAbschnittZeichnenStart(3)) },
  {
    name: 'zone-zeichnen',
    familie: 'zone',
    betreten: (r) => act(() => r.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' })),
  },
  {
    name: 'zone-bestaetigung',
    familie: 'zone',
    betreten: (r) => {
      act(() => r.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
      act(() => r.current.onZoneGezeichnet(POLYGON));
    },
  },
  // LFH-170: das Platzieren eines freien Zeichens ist ebenfalls exklusiv → muss das
  // Selektions-Gate (exklusiverModusAktiv) auslösen.
  {
    name: 'zeichen-platzieren',
    familie: 'zeichen',
    betreten: (r) => act(() => r.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' })),
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
  return [...f].sort();
}

// LFH-243/F15: Die Exklusivität der Interaktionsmodi wurde bisher in jedem Start-Handler
// von Hand durch Reset-Kaskaden erzwungen — mit asymmetrischen Subsets, sodass ein
// vergessener Reset zwei gleichzeitig scharfe Modi erlaubt (Bug-Klasse LFH-145). Dieses
// Kreuzprodukt prüft die Invariante erschöpfend statt stichprobenartig.
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

  // onEinsatzortPlatzieren ist ein eigener Start-Handler derselben Familie `platzieren`
  // (das Kreuzprodukt oben überspringt ihn deshalb), hat aber dieselbe Reset-Lücke.
  for (const zuerst of MODI.filter((m) => m.familie !== 'platzieren')) {
    it(`${zuerst.name} → einsatzort-platzieren: nur platzieren bleibt scharf`, () => {
      const { result } = rendere();
      zuerst.betreten(result);
      act(() => result.current.onEinsatzortPlatzieren());
      expect(aktiveFamilien(result)).toEqual(['platzieren']);
    });
  }

  // Phasen-Invariante innerhalb der zone-Familie (LFH-145): die Bestätigungs-Phase ist ein
  // Sub-Zustand des Zeichnens — der sichtbare Entwurf muss bestehen bleiben, solange die
  // Bestätigung offen ist (das Kreuzprodukt überspringt diesen Intra-Familie-Übergang).
  it('onZoneGezeichnet öffnet die Bestätigung, OHNE den Entwurf zu verlieren', () => {
    const { result } = rendere();
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    act(() => result.current.onZoneGezeichnet(POLYGON));
    expect(result.current.zoneEntwurf).not.toBeNull();
    expect(result.current.zoneBestaetigung).not.toBeNull();
  });
});

// LFH-243/F15: Die drei Auswahl-States (Marker/Abschnitt-`auswahl`, `zoneAuswahl`,
// `fachebeneAuswahl`) sind ebenfalls wechselseitig exklusiv — nur ein Detail-Panel darf
// offen sein. Auch hier erzwang jeder Klick-Handler die Exklusivität per Reset-Kaskade,
// und onFlaecheKlick vergaß zoneAuswahl → zwei Panels gleichzeitig (LagekartePage rendert
// jeden Inspektor unabhängig, ohne else). Erschöpfend statt stichprobenartig geprüft.
const SELEKTIONEN: { name: string; feld: 'auswahl' | 'zoneAuswahl' | 'fachebeneAuswahl'; waehlen: (r: HookResult) => void }[] = [
  { name: 'marker', feld: 'auswahl', waehlen: (r) => act(() => r.current.onMarkerWaehlen('uhs-1')) },
  { name: 'abschnitt', feld: 'auswahl', waehlen: (r) => act(() => r.current.onFlaecheKlick(3)) },
  { name: 'zone', feld: 'zoneAuswahl', waehlen: (r) => act(() => r.current.onZoneKlick(5)) },
  { name: 'fachebene', feld: 'fachebeneAuswahl', waehlen: (r) => act(() => r.current.onFachebeneKlick({ a: 1 }, 'nina')) },
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

describe('useKartenInteraktion — Selektions-Gate während exklusiver Modi (LFH-208)', () => {
  describe('Baseline: ohne aktiven Modus selektiert der Klick normal', () => {
    it('onZoneKlick setzt zoneAuswahl', () => {
      const { result } = rendere();
      act(() => result.current.onZoneKlick(5));
      expect(result.current.zoneAuswahl).toBe(5);
    });
    it('onFachebeneKlick reicht die (un-geclippte) Geometrie an fachebeneAuswahl durch (LFH-146)', () => {
      const { result } = rendere();
      const geom = { type: 'Polygon', coordinates: [[[8, 50], [8.1, 50], [8.1, 50.1], [8, 50]]] };
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

  // Restabdeckung Mutual-Exclusion (LFH-170): jeder weitere exklusive Start-Handler räumt
  // einen offenen zeichenPlatzieren-Modus (onZoneZeichnenStart ist oben schon geprüft).
  const RAEUMT_ZEICHEN_PLATZIEREN: { name: string; start: (r: HookResult) => void }[] = [
    { name: 'onAbschnittZeichnenStart', start: (r) => act(() => r.current.onAbschnittZeichnenStart(3)) },
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
    // zoneBestaetigung aufbauen: Zone-Zeichnen starten, dann Geometrie abschließen (vgl. MODI
    // „zone-bestaetigung"). onZoneGezeichnet setzt zoneBestaetigung, ohne zu persistieren.
    act(() => result.current.onZoneZeichnenStart({ typ: 'gefahrengebiet', modus: 'polygon' }));
    act(() => result.current.onZoneGezeichnet(POLYGON));
    expect(result.current.zoneBestaetigung).not.toBeNull();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle' }));
    expect(result.current.zoneBestaetigung).toBeNull();
  });

  it('onKarteKlick bei aktivem zeichenPlatzieren legt ein freies Zeichen an (POST mit Klick-Koordinate)', async () => {
    freieZeichenApi.legeFreiesZeichenAn.mockClear();
    const { result } = rendere();
    act(() => result.current.onZeichenPlatzierenStart({ grundzeichen: 'stelle', label: 'X' }));
    act(() => result.current.onKarteKlick({ lng: 8.6, lat: 50.1 }));
    await waitFor(() =>
      expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledWith(1, {
        lat: 50.1,
        lon: 8.6,
        grundzeichen: 'stelle',
        label: 'X',
        // B/LFH-320: ohne aktive Ansicht wird auf „alle Ansichten" (null) gestempelt.
        ansicht_id: null,
      }),
    );
    // nach erfolgreichem Anlegen ist der Platzier-Modus beendet
    await waitFor(() => expect(result.current.zeichenPlatzieren).toBeNull());
  });

  it('Doppelklick legt nur EIN freies Zeichen an (isPending-Guard, kein Duplikat)', async () => {
    // Mutation pending halten → der zweite Klick trifft den Guard, bevor onSuccess
    // zeichenPlatzieren leert. legeFreiesZeichenAn erzeugt je Aufruf eine NEUE Entität
    // (nicht idempotent), ein zweiter Aufruf würde ein Duplikat anlegen.
    let aufloesen: (v: { id: number }) => void = () => {};
    freieZeichenApi.legeFreiesZeichenAn.mockReset();
    freieZeichenApi.legeFreiesZeichenAn.mockImplementation(
      () => new Promise((r) => { aufloesen = r; }),
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
    await waitFor(() =>
      expect(freieZeichenApi.loescheFreiesZeichen).toHaveBeenCalledWith(1, 42),
    );
    // setAuswahl(null) läuft im .then nach erfolgreichem DELETE.
    await waitFor(() => expect(result.current.auswahl).toBeNull());
  });
});
