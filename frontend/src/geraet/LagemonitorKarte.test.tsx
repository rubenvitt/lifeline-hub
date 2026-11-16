import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Component, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import LagemonitorKarte from './LagemonitorKarte';

/**
 * Karte des Lagemonitors (Spec `lagemonitor`) auf einem Gerät ohne Kartengrafik (LLH-1377, wie
 * LLH-1353/LLH-1370): maplibres Konstruktor wirft dort `GPUInitializationError`. Statt den Monitor
 * in die Fehlerseite der App zu reißen, steht an Stelle der Karte der Zustand in Großbild-Schrift;
 * jeder andere Wurf fliegt weiter. Der Nachbau wirft wie maplibre (`name` gesetzt), sonst ist jede
 * Methode ein stummer Spion.
 *
 * Mutationsprobe: Fang im Karten-Effekt weg → der Fall „ohne Kartengrafik“ landet in der
 * Fehlergrenze, rot; Fang ohne `isGrafikFehler` (alles fangen) → der letzte Fall zeigt den
 * Zustand statt des Fehlers, rot.
 */
const karte = vi.hoisted(() => ({
  wurf: null as null | (() => Error),
  gebaut: 0,
  marker: 0,
  /** Die Elemente der Marken, wie maplibre sie bekäme (LLH-1746). */
  elemente: [] as HTMLElement[],
  optionen: null as null | Record<string, unknown>,
}));

vi.mock('maplibre-gl', () => {
  function spion() {
    return new Proxy({} as Record<PropertyKey, unknown>, {
      get(ziel, schluessel) {
        if (!(schluessel in ziel)) ziel[schluessel] = vi.fn(() => spion());
        return ziel[schluessel];
      },
    });
  }
  class Map {
    constructor(optionen: Record<string, unknown>) {
      if (karte.wurf) throw karte.wurf();
      karte.gebaut += 1;
      karte.optionen = optionen;
      return spion();
    }
  }
  class Marker {
    constructor(optionen?: { element?: HTMLElement }) {
      karte.marker += 1;
      if (optionen?.element) karte.elemente.push(optionen.element);
      return spion();
    }
  }
  return { Map, Marker };
});
vi.mock('../pages/lagekarte/maplibreWorker', () => ({}));
vi.mock('../pages/lagekarte/kartenDaten', () => ({ wendeKartenDatenAn: vi.fn() }));

/** Fehlergrenze wie die der Route: zeigt den gefangenen Fehler statt der Seite. */
class Grenze extends Component<{ children: ReactNode }, { fehler: Error | null }> {
  state = { fehler: null as Error | null };
  static getDerivedStateFromError(fehler: Error) {
    return { fehler };
  }
  render() {
    return this.state.fehler ? `gefangen: ${this.state.fehler.message}` : this.props.children;
  }
}

function grafikFehler() {
  const f = new Error('WebGL2 is required to display this map.');
  f.name = 'GPUInitializationError';
  return f;
}

function zeige() {
  return renderMitProviders(
    <Grenze>
      <LagemonitorKarte einsatzort={{ lat: 52.52, lon: 13.405 }} uhs={[]} />
    </Grenze>,
  );
}

beforeEach(() => {
  karte.wurf = null;
  karte.gebaut = 0;
  karte.marker = 0;
  karte.elemente = [];
  karte.optionen = null;
  server.use(
    http.get('/api/karte/config', () =>
      HttpResponse.json({
        online_styles: [],
        offline_verfuegbar: false,
        offline_tiles_url: null,
        offline_attribution: null,
        offline_regionen: [],
        karten_bau_verfuegbar: false,
      }),
    ),
  );
});

describe('LagemonitorKarte ohne Kartengrafik (LLH-1377)', () => {
  it('mit Kartengrafik: Karte samt Einsatzort, kein Zustand', async () => {
    zeige();
    expect(screen.getByRole('img', { name: 'Lagekarte des Einsatzgebiets' })).toBeInTheDocument();
    await waitFor(() => expect(karte.gebaut).toBe(1));
    await waitFor(() => expect(karte.marker).toBe(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('zeigt den Zustand in Großbild-Schrift an Stelle der Karte und wirft nicht', async () => {
    karte.wurf = grafikFehler;
    zeige();
    const zustand = await screen.findByRole('status');
    expect(zustand).toHaveTextContent('Karte auf diesem Gerät nicht darstellbar');
    expect(zustand).toHaveAttribute('data-lfh', 'karte-nicht-darstellbar');
    // Großbild-Regel (`geraet/AGENTS.md`): jeder Text mindestens 28 px, die Kachel bleibt gefüllt.
    expect(zustand).toHaveStyle({ fontSize: '28px', height: '100%' });
    expect(screen.queryByText(/gefangen/)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/webgl/i)).toBeNull();
    expect(karte.marker).toBe(0);
  });

  it('ohne Ausschnitt bleibt „Kein Einsatzort verortet“, ohne Kartenbau', async () => {
    karte.wurf = grafikFehler;
    renderMitProviders(
      <Grenze>
        <LagemonitorKarte einsatzort={null} uhs={[]} />
      </Grenze>,
    );
    expect(screen.getByText('Kein Einsatzort verortet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(karte.gebaut).toBe(0);
  });

  it('ein anderer Fehler des Konstruktors bleibt ein Fehler', async () => {
    karte.wurf = () => new Error('kaputt');
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      zeige();
      expect(await screen.findByText('gefangen: kaputt')).toBeInTheDocument();
      expect(screen.queryByText('Karte auf diesem Gerät nicht darstellbar')).toBeNull();
    } finally {
      konsole.mockRestore();
    }
  });
});

/**
 * Quellenangabe (LLH-1496): bedienbar (Lagebild für Externe, öffentlich geteilt) steht die
 * hinterlegte Lizenz der Grundlage auf der Karte, wie auf der Lagekarte; der Monitor an der Wand
 * bleibt ohne. Mutationsprobe: `customAttribution` weg → der erste Fall rot.
 */
describe('LagemonitorKarte Quellenangabe (LLH-1496)', () => {
  const ODBL = '© OpenStreetMap contributors (ODbL)';
  beforeEach(() => {
    server.use(
      http.get('/api/karte/config', () =>
        HttpResponse.json({
          online_styles: [],
          offline_verfuegbar: true,
          offline_tiles_url: '/api/karte/offline/1/tiles/{z}/{x}/{y}',
          offline_attribution: ODBL,
          offline_regionen: [
            {
              karte_id: 1,
              name: 'R1',
              tiles_url: '/api/karte/offline/1/tiles/{z}/{x}/{y}',
              attribution: ODBL,
              format: 'vektor',
              maxzoom: 14,
            },
          ],
          karten_bau_verfuegbar: false,
        }),
      ),
    );
  });

  it('bedienbar: hinterlegte Lizenz der Grundlage', async () => {
    renderMitProviders(
      <LagemonitorKarte einsatzort={{ lat: 52.52, lon: 13.405 }} uhs={[]} bedienbar />,
    );
    await waitFor(() => expect(karte.gebaut).toBe(1));
    expect(karte.optionen?.attributionControl).toEqual({
      compact: true,
      customAttribution: ODBL,
    });
  });

  it('Monitor an der Wand: ohne Quellenangabe', async () => {
    zeige();
    await waitFor(() => expect(karte.gebaut).toBe(1));
    expect(karte.optionen?.attributionControl).toBe(false);
  });
});

/**
 * Beschriftung der Gefahrenzonen und Belegung der UHS auf der Karte (LLH-1746, Spec `lagemonitor`).
 * Mutationsprobe: Zonenmarken nicht zeichnen → der erste Fall rot; Alarmrand an jeder UHS → der
 * zweite Fall rot (die volle UHS trüge ihn).
 */
describe('LagemonitorKarte Marken (LLH-1746)', () => {
  const POLY = JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [13.4, 52.5],
        [13.41, 52.5],
        [13.41, 52.51],
        [13.4, 52.5],
      ],
    ],
  });
  const marke = (lfh: string) => karte.elemente.filter((e) => e.dataset.lfh === lfh);

  it('beschriftet ein Gefahrengebiet mit Name und Stufe in Großbild-Schrift', async () => {
    renderMitProviders(
      <LagemonitorKarte
        einsatzort={{ lat: 52.52, lon: 13.405 }}
        uhs={[]}
        zonen={[
          {
            id: 1,
            typ: 'gefahrengebiet',
            geometrie: POLY,
            gebiet: { bezeichnung: 'Hangrutsch Kirchberg', warnstufe: 'hoch', bestaetigt: false },
          },
          { id: 2, typ: 'absperrbereich', geometrie: POLY },
        ]}
      />,
    );
    await waitFor(() => expect(marke('monitor-zone')).toHaveLength(2));
    const [gebiet, absperrung] = marke('monitor-zone');
    expect(gebiet).toHaveTextContent('Hangrutsch Kirchberg · hoch · unbestätigt');
    expect(gebiet.dataset.rolle).toBe('alarm');
    expect(gebiet.style.fontSize).toBe('28px');
    expect(absperrung).toHaveTextContent('Absperrbereich');
    expect(absperrung.dataset.rolle).toBeUndefined();
  });

  it('zeigt an der UHS Belegte und Plätze, überbelegt in der Alarmrolle', async () => {
    const uhs = (id: number, bezeichnung: string, belegt: number, plaetze: number) => ({
      id,
      bezeichnung,
      typ: 'behandlungsplatz' as const,
      status: 'aktiv' as const,
      lat: 52.52,
      lon: 13.41,
      belegt,
      plaetze,
      kraefte: 0,
    });
    renderMitProviders(
      <LagemonitorKarte
        einsatzort={{ lat: 52.52, lon: 13.405 }}
        uhs={[uhs(1, 'Turnhalle', 8, 5), uhs(2, 'Schule', 5, 5), uhs(3, 'Zelt', 2, 0)]}
      />,
    );
    await waitFor(() => expect(marke('monitor-uhs-marke')).toHaveLength(3));
    const [turnhalle, schule, zelt] = marke('monitor-uhs-marke');
    expect(turnhalle).toHaveTextContent('Turnhalle · 8/5');
    expect(turnhalle.dataset.ueberbelegt).toBe('ja');
    expect(schule).toHaveTextContent('Schule · 5/5');
    expect(schule.dataset.ueberbelegt).toBe('nein');
    expect(zelt).toHaveTextContent('Zelt · 2');
    expect(zelt.dataset.ueberbelegt).toBe('nein');
  });
});
