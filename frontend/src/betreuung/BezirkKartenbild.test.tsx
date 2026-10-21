import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Component, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LageZone } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { bezirkFlaechen } from './bezirkFlaechen';
import BezirkKartenbild from './BezirkKartenbild';

/**
 * Kartenbild des Evakuierungsbezirks (LLH-1076) auf einem Gerät ohne Kartengrafik (LLH-1370):
 * maplibres Konstruktor wirft dort `GPUInitializationError`. Statt die Bezirksseite in die
 * Fehlerseite der App zu reißen, steht an Stelle der Karte der Zustand; jeder andere Wurf fliegt
 * weiter. Der Nachbau wirft wie maplibre (`name` gesetzt), sonst ist jede Methode ein stummer Spion.
 *
 * Mutationsprobe: Fang im Karten-Effekt weg → der Fall „ohne Kartengrafik“ landet in der
 * Fehlergrenze, rot; Fang ohne `isGrafikFehler` (alles fangen) → der letzte Fall zeigt den
 * Zustand statt des Fehlers, rot.
 */
const karte = vi.hoisted(() => ({
  wurf: null as null | (() => Error),
  gebaut: 0,
}));

vi.mock('maplibre-gl', () => {
  class Map {
    constructor() {
      if (karte.wurf) throw karte.wurf();
      karte.gebaut += 1;
      return new Proxy({} as Record<PropertyKey, unknown>, {
        get(ziel, schluessel) {
          if (!(schluessel in ziel)) ziel[schluessel] = vi.fn();
          return ziel[schluessel];
        },
      });
    }
  }
  return { Map };
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

const ZONE = {
  id: 1,
  typ: 'evakuierungsbezirk',
  evakuierungsbezirk_id: 7,
  farbe: null,
  geometrie: JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [9.14, 49.35],
        [9.15, 49.35],
        [9.15, 49.36],
        [9.14, 49.35],
      ],
    ],
  }),
} as unknown as LageZone;
const FLAECHEN = bezirkFlaechen([ZONE], 7);

function grafikFehler() {
  const f = new Error('WebGL2 is required to display this map.');
  f.name = 'GPUInitializationError';
  return f;
}

function zeige() {
  return renderMitProviders(
    <Grenze>
      <BezirkKartenbild flaechen={FLAECHEN} etikett="Karte: Gebiet von Bezirk Ufer" />
    </Grenze>,
  );
}

beforeEach(() => {
  karte.wurf = null;
  karte.gebaut = 0;
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

describe('BezirkKartenbild ohne Kartengrafik (LLH-1370)', () => {
  it('mit Kartengrafik: Karte ohne Zustand', async () => {
    zeige();
    expect(screen.getByRole('img', { name: 'Karte: Gebiet von Bezirk Ufer' })).toBeInTheDocument();
    await waitFor(() => expect(karte.gebaut).toBe(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('zeigt den Zustand an Stelle der Karte und wirft nicht', async () => {
    karte.wurf = grafikFehler;
    zeige();
    const zustand = await screen.findByRole('status');
    expect(zustand).toHaveTextContent('Karte auf diesem Gerät nicht darstellbar');
    expect(zustand).toHaveAttribute('data-lfh', 'karte-nicht-darstellbar');
    expect(screen.queryByText(/gefangen/)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/webgl/i)).toBeNull();
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
