import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Component, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { Kartenausschnitt, nadelZielStil, NADEL_SCHRITT_GROSS_PX } from './Kartenausschnitt';

/**
 * Kartenausschnitt (LFH-1175, Spec `ortsfeld`, „Kartenausschnitt zeigt den Ort“). MapLibre läuft
 * in jsdom nicht; der Nachbau hält fest, wohin die Karte springt und welche Nadel sie trägt.
 */

interface Nadel {
  element: HTMLElement;
  lngLat: [number, number] | null;
  ziehbar: boolean;
  hoerer: Record<string, () => void>;
}

const karte = vi.hoisted(() => ({
  /** Setzt ein Fall ihn, wirft der Konstruktor wie maplibre (LLH-1370). */
  wurf: null as null | (() => Error),
  optionen: [] as Record<string, unknown>[],
  spruenge: [] as unknown[],
  nadeln: [] as Nadel[],
}));

vi.mock('maplibre-gl', () => {
  class Map {
    constructor(o: Record<string, unknown>) {
      if (karte.wurf) throw karte.wurf();
      karte.optionen.push(o);
    }
    jumpTo(z: unknown) {
      karte.spruenge.push(z);
    }
    // Ein Grad je Bildpunkt: genug, um die Richtung der Pfeiltasten zu prüfen.
    project(l: { lng: number; lat: number }) {
      return { x: l.lng, y: -l.lat };
    }
    unproject([x, y]: [number, number]) {
      return { lng: x, lat: -y };
    }
    remove() {}
  }
  class Marker {
    eintrag: Nadel;
    constructor(o: { element: HTMLElement; draggable?: boolean }) {
      this.eintrag = { element: o.element, lngLat: null, ziehbar: !!o.draggable, hoerer: {} };
      karte.nadeln.push(this.eintrag);
    }
    setLngLat(l: [number, number] | { lng: number; lat: number }) {
      this.eintrag.lngLat = Array.isArray(l) ? l : [l.lng, l.lat];
      return this;
    }
    getLngLat() {
      const [lng, lat] = this.eintrag.lngLat!;
      return { lng, lat };
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

beforeEach(() => {
  karte.wurf = null;
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

  it('ohne `onVerschieben` ist die Nadel kein Bedienziel', async () => {
    renderMitProviders(<Kartenausschnitt punkt={{ lat: 51, lon: 10 }} etikett="Einsatzort" />);
    await waitFor(() => expect(karte.nadeln).toHaveLength(1));
    expect(karte.nadeln[0].ziehbar).toBe(false);
    expect(karte.nadeln[0].element.tabIndex).toBe(-1);
    expect(screen.getByRole('img', { name: 'Karte: Einsatzort' })).toHaveStyle({
      pointerEvents: 'none',
    });
  });

  it('mit `onVerschieben` ist die Nadel ziehbar und meldet den neuen Punkt, ohne die Karte zu springen', async () => {
    const onVerschieben = vi.fn();
    const { rerender } = renderMitProviders(
      <Kartenausschnitt
        punkt={{ lat: 51, lon: 10 }}
        etikett="Einsatzort"
        onVerschieben={onVerschieben}
      />,
    );
    await waitFor(() => expect(karte.nadeln).toHaveLength(1));
    const nadel = karte.nadeln[0];
    expect(nadel.ziehbar).toBe(true);
    expect(screen.getByRole('group', { name: 'Karte: Einsatzort' })).toBeInTheDocument();
    // Der Nachbau hängt die Nadel nicht ein; ihre Merkmale stehen am Element.
    expect(nadel.element.getAttribute('role')).toBe('button');
    expect(nadel.element.getAttribute('aria-label')).toBe('Einsatzort');
    expect(karte.optionen[0]).toMatchObject({ interactive: false });

    // Ziehen mit der Maus: MapLibre meldet `dragend` an der neuen Stelle.
    nadel.lngLat = [10.5, 51.5];
    nadel.hoerer.dragend();
    expect(onVerschieben).toHaveBeenLastCalledWith({ lat: 51.5, lon: 10.5 });

    // Der gemeldete Punkt kommt zurück: die Nadel steht dort, die Karte springt nicht nach.
    const spruenge = karte.spruenge.length;
    rerender(
      <Kartenausschnitt
        punkt={{ lat: 51.5, lon: 10.5 }}
        etikett="Einsatzort"
        onVerschieben={onVerschieben}
      />,
    );
    await waitFor(() => expect(karte.nadeln[0].lngLat).toEqual([10.5, 51.5]));
    expect(karte.spruenge).toHaveLength(spruenge);
  });

  it('Pfeiltasten verschieben die Nadel, Umschalt im großen Schritt', async () => {
    const onVerschieben = vi.fn();
    renderMitProviders(
      <Kartenausschnitt
        punkt={{ lat: 0, lon: 0 }}
        etikett="Einsatzort"
        onVerschieben={onVerschieben}
      />,
    );
    await waitFor(() => expect(karte.nadeln).toHaveLength(1));
    const el = karte.nadeln[0].element;
    expect(el.tabIndex).toBe(0);
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(onVerschieben).toHaveBeenLastCalledWith({ lat: -0, lon: 10 });
    fireEvent.keyDown(el, { key: 'ArrowUp', shiftKey: true });
    expect(onVerschieben).toHaveBeenLastCalledWith({ lat: NADEL_SCHRITT_GROSS_PX, lon: 10 });
    fireEvent.keyDown(el, { key: 'a' });
    expect(onVerschieben).toHaveBeenCalledTimes(2);
  });

  it('die Trefffläche der Nadel ist die Steuerhöhe jeder Dichtestufe', () => {
    for (const controlHeight of [30, 48, 72]) {
      const stil = nadelZielStil({ controlHeight });
      expect(stil.width).toBe(`${controlHeight}px`);
      expect(stil.height).toBe(`${controlHeight}px`);
      expect(stil.pointerEvents).toBe('auto');
    }
  });

  it('zeigt ohne Kartengrafik den Zustand statt der Karte und wirft nicht (LLH-1370)', async () => {
    karte.wurf = () => {
      const f = new Error('WebGL2 is required to display this map.');
      f.name = 'GPUInitializationError';
      return f;
    };
    renderMitProviders(
      <Kartenausschnitt punkt={{ lat: 51.1604, lon: 10.4514 }} etikett="Einsatzort" />,
    );
    const zustand = await screen.findByRole('status');
    expect(zustand).toHaveTextContent('Karte auf diesem Gerät nicht darstellbar');
    expect(zustand).toHaveAttribute('data-lfh', 'karte-nicht-darstellbar');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(/webgl/i)).toBeNull();
    expect(karte.nadeln).toHaveLength(0);
  });
});

/**
 * Jeder andere Wurf beim Aufbau bleibt ein Fehler (LLH-1370): eine Fehlergrenze fängt ihn, der
 * Zustand erscheint nicht. Mutationsprobe: Fang ohne `isGrafikFehler` (alles fangen) → rot.
 */
describe('Kartenausschnitt: anderer Fehler', () => {
  it('fliegt weiter', async () => {
    karte.wurf = () => new Error('kaputt');
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderMitProviders(
      <Grenze>
        <Kartenausschnitt punkt={{ lat: 51.1604, lon: 10.4514 }} etikett="Einsatzort" />
      </Grenze>,
    );
    expect(await screen.findByText('gefangen: kaputt')).toBeInTheDocument();
    expect(screen.queryByText('Karte auf diesem Gerät nicht darstellbar')).toBeNull();
    fehler.mockRestore();
  });
});
