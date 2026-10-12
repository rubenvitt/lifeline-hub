import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { Kartenausschnitt } from './Kartenausschnitt';

/**
 * Kartenausschnitt (LFH-1175, Spec `ortsfeld`, „Kartenausschnitt zeigt den Ort“). MapLibre läuft
 * in jsdom nicht; der Nachbau hält fest, wohin die Karte springt und welche Nadel sie trägt.
 */

const karte = vi.hoisted(() => ({
  optionen: [] as Record<string, unknown>[],
  spruenge: [] as unknown[],
  nadeln: [] as { element: HTMLElement; lngLat: [number, number] | null }[],
}));

vi.mock('maplibre-gl', () => {
  class Map {
    constructor(o: Record<string, unknown>) {
      karte.optionen.push(o);
    }
    jumpTo(z: unknown) {
      karte.spruenge.push(z);
    }
    remove() {}
  }
  class Marker {
    eintrag: { element: HTMLElement; lngLat: [number, number] | null };
    constructor(o: { element: HTMLElement }) {
      this.eintrag = { element: o.element, lngLat: null };
      karte.nadeln.push(this.eintrag);
    }
    setLngLat(l: [number, number]) {
      this.eintrag.lngLat = l;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      karte.nadeln.splice(karte.nadeln.indexOf(this.eintrag), 1);
    }
  }
  return { Map, Marker };
});
vi.mock('../pages/lagekarte/maplibreWorker', () => ({}));

beforeEach(() => {
  karte.optionen.length = 0;
  karte.spruenge.length = 0;
  karte.nadeln.length = 0;
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

describe('Kartenausschnitt', () => {
  it('zeigt ohne Punkt „Nicht verortet“ und baut keine Karte', async () => {
    renderMitProviders(<Kartenausschnitt punkt={null} etikett="Einsatzort" />);
    expect(screen.getByText('Nicht verortet')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // Auch nach dem Laden der Konfiguration entsteht keine Karte.
    await new Promise((r) => setTimeout(r, 20));
    expect(karte.optionen).toHaveLength(0);
  });

  it('zeigt eine Karte ohne Bedienung um den Punkt mit einer Nadel', async () => {
    renderMitProviders(
      <Kartenausschnitt punkt={{ lat: 51.1604, lon: 10.4514 }} etikett="Einsatzort" />,
    );
    expect(screen.getByRole('img', { name: 'Karte: Einsatzort' })).toBeInTheDocument();
    await waitFor(() => expect(karte.optionen).toHaveLength(1));
    expect(karte.optionen[0]).toMatchObject({ interactive: false });
    await waitFor(() => expect(karte.nadeln).toHaveLength(1));
    expect(karte.nadeln[0].lngLat).toEqual([10.4514, 51.1604]);
    expect(karte.nadeln[0].element.getAttribute('aria-label')).toBe('Einsatzort');
    expect(karte.spruenge[karte.spruenge.length - 1]).toMatchObject({ center: [10.4514, 51.1604] });
  });
});
