import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { PUNKT_ZOOM } from '../pages/lagekarte/startAnsicht';
import { KarteWaehlen } from './KarteWaehlen';

/**
 * „Auf Karte wählen“ (LLH-1108, Spec `ortsfeld`). MapLibre läuft in jsdom nicht; der Nachbau hält
 * die Optionen, den Klick-Hörer und die Nadeln fest.
 */

interface Nadel {
  lngLat: [number, number];
  ziehbar: boolean;
  element: HTMLElement;
  hoerer: Record<string, () => void>;
}

const karte = vi.hoisted(() => ({
  /** Setzt ein Fall ihn, wirft der Konstruktor wie maplibre ohne Kartengrafik (LLH-1370). */
  wurf: null as null | (() => Error),
  optionen: [] as Record<string, unknown>[],
  klick: null as null | ((e: { lngLat: { lng: number; lat: number } }) => void),
  nadeln: [] as Nadel[],
}));

vi.mock('maplibre-gl', () => {
  class Map {
    constructor(o: Record<string, unknown>) {
      if (karte.wurf) throw karte.wurf();
      karte.optionen.push(o);
    }
    on(art: string, f: (e: { lngLat: { lng: number; lat: number } }) => void) {
      if (art === 'click') karte.klick = f;
      return this;
    }
    resize() {}
    remove() {}
  }
  class Marker {
    eintrag: Nadel;
    constructor(o: { element: HTMLElement; draggable?: boolean }) {
      this.eintrag = { lngLat: [0, 0], ziehbar: !!o.draggable, element: o.element, hoerer: {} };
      karte.nadeln.push(this.eintrag);
    }
    setLngLat(l: [number, number]) {
      this.eintrag.lngLat = l;
      return this;
    }
    getLngLat() {
      return { lng: this.eintrag.lngLat[0], lat: this.eintrag.lngLat[1] };
    }
    on(art: string, f: () => void) {
      this.eintrag.hoerer[art] = f;
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
  karte.wurf = null;
  karte.optionen.length = 0;
  karte.klick = null;
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

function aufbau(props: Partial<Parameters<typeof KarteWaehlen>[0]> = {}) {
  const onUebernehmen = vi.fn();
  const onAbbrechen = vi.fn();
  renderMitProviders(
    <KarteWaehlen
      offen
      etikett="Einsatzort"
      punkt={null}
      onUebernehmen={onUebernehmen}
      onAbbrechen={onAbbrechen}
      {...props}
    />,
  );
  return { onUebernehmen, onAbbrechen };
}

describe('KarteWaehlen', () => {
  it('ohne Kartengrafik: Zustand statt Karte, kein Absturz, Abbrechen geht (LLH-1370)', async () => {
    karte.wurf = () => {
      const f = new Error('WebGL2 is required to display this map.');
      f.name = 'GPUInitializationError';
      return f;
    };
    const { onAbbrechen } = aufbau();
    const zustand = await screen.findByText('Karte auf diesem Gerät nicht darstellbar');
    expect(zustand).toHaveAttribute('data-lfh', 'karte-nicht-darstellbar');
    expect(screen.queryByRole('application')).toBeNull();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalled();
  });

  it('ohne Punkt: Karte mit Bedienung über der Umgebung, „Übernehmen“ gesperrt bis zum Klick', async () => {
    const { onUebernehmen } = aufbau({ umgebung: { lat: 53, lon: 8.8 } });
    const dialog = await screen.findByRole('dialog', { name: 'Einsatzort auf Karte wählen' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(karte.optionen).toHaveLength(1));
    expect(karte.optionen[0].interactive).not.toBe(false);
    expect(karte.optionen[0]).toMatchObject({ center: [8.8, 53] });
    expect(karte.nadeln).toHaveLength(0);
    const uebernehmen = screen.getByRole('button', { name: 'Übernehmen' });
    expect(uebernehmen).toBeDisabled();

    act(() => karte.klick!({ lngLat: { lng: 8.81, lat: 53.07 } }));
    await waitFor(() => expect(karte.nadeln).toHaveLength(1));
    expect(karte.nadeln[0]).toMatchObject({ lngLat: [8.81, 53.07], ziehbar: true });
    expect(karte.nadeln[0].element.getAttribute('aria-label')).toBe('Einsatzort');

    // Ein zweiter Klick versetzt dieselbe Nadel.
    act(() => karte.klick!({ lngLat: { lng: 8.9, lat: 53.1 } }));
    await waitFor(() => expect(karte.nadeln[0].lngLat).toEqual([8.9, 53.1]));
    expect(karte.nadeln).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onUebernehmen).toHaveBeenCalledWith({ lat: 53.1, lon: 8.9 });
  });

  it('mit Punkt: beginnt dort mit Nadel; Ziehen ändert die Wahl', async () => {
    const { onUebernehmen } = aufbau({
      punkt: { lat: 51, lon: 10 },
      umgebung: { lat: 53, lon: 8 },
    });
    await waitFor(() => expect(karte.nadeln).toHaveLength(1));
    expect(karte.optionen[0]).toMatchObject({ center: [10, 51], zoom: PUNKT_ZOOM });
    const nadel = karte.nadeln[0];
    nadel.lngLat = [10.2, 51.2];
    act(() => nadel.hoerer.dragend());
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onUebernehmen).toHaveBeenCalledWith({ lat: 51.2, lon: 10.2 });
  });

  it('ohne Punkt und Umgebung beginnt die Karte über Deutschland', async () => {
    aufbau();
    await waitFor(() => expect(karte.optionen).toHaveLength(1));
    expect(karte.optionen[0]).toMatchObject({ center: [10.45, 51.16], zoom: 5 });
  });

  it('Abbrechen meldet nichts', async () => {
    const { onUebernehmen, onAbbrechen } = aufbau({ punkt: { lat: 51, lon: 10 } });
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalled();
    expect(onUebernehmen).not.toHaveBeenCalled();
  });
});
