import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meldeClientFehler } from '../api/clientFehler';
import { renderMitProviders } from '../test/utils';
import KachelGrenze, { KACHELGRENZE_SELEKTOR, KACHELGRENZE_TITEL } from './KachelGrenze';

/**
 * Fehlergrenze je Kachel (LLH-1958, `frontend/AGENTS.md`, „Jede Kachel einer Lagefläche hat ihre
 * eigene Fehlergrenze“). Der Bericht ist gemockt: hier zählt, wie oft und womit er gerufen wird.
 */
vi.mock('../api/clientFehler', () => ({
  meldeClientFehler: vi.fn(() => Promise.resolve()),
}));

function Wirft(): never {
  throw new Error('geheim-123');
}

function WirftImHook() {
  useMemo(() => {
    throw new Error('im-hook');
  }, []);
  return null;
}

beforeEach(() => {
  vi.mocked(meldeClientFehler).mockClear();
  // React schreibt gefangene Würfe zusätzlich in die Konsole; das ist hier erwartet.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KachelGrenze', () => {
  it('wirft eine Kachel, zeigt nur sie den Hinweis; die Nachbarkachel bleibt bedienbar', async () => {
    const nachbar = vi.fn();
    renderMitProviders(
      <>
        <KachelGrenze titel="Nächste Marken">
          <Wirft />
        </KachelGrenze>
        <button type="button" onClick={nachbar}>
          Nachbar
        </button>
      </>,
    );

    expect(screen.getByText(KACHELGRENZE_TITEL)).toBeInTheDocument();
    expect(screen.getByText('Nächste Marken')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nachbar' }));
    expect(nachbar).toHaveBeenCalledTimes(1);
  });

  it('genau ein Bericht mit der Adresse der Seite, ohne Meldung im DOM', () => {
    renderMitProviders(
      <KachelGrenze titel="Nächste Marken">
        <Wirft />
      </KachelGrenze>,
    );

    expect(meldeClientFehler).toHaveBeenCalledTimes(1);
    expect(meldeClientFehler).toHaveBeenCalledWith(expect.any(Error), window.location.pathname);
    expect(screen.queryByText(/geheim-123/)).toBeNull();
  });

  it('ein Wurf im Hook der Kachel landet in der Grenze', () => {
    renderMitProviders(
      <KachelGrenze titel="Offene Vorgänge">
        <WirftImHook />
      </KachelGrenze>,
    );

    expect(screen.getByText(KACHELGRENZE_TITEL)).toBeInTheDocument();
  });

  it('ohne Wurf zeichnet die Grenze nur ihr Kind, in einer Hülle mit display: contents', () => {
    const { container } = renderMitProviders(
      <KachelGrenze titel="Sichtung">
        <span>Inhalt</span>
      </KachelGrenze>,
    );

    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    const huelle = container.querySelector<HTMLElement>(KACHELGRENZE_SELEKTOR);
    expect(huelle?.style.display).toBe('contents');
    expect(meldeClientFehler).not.toHaveBeenCalled();
  });

  it('Form gross: kein Knopf, Titel mit Punkt', () => {
    renderMitProviders(
      <KachelGrenze titel="Kräfte" form="gross">
        <Wirft />
      </KachelGrenze>,
    );

    expect(screen.getByText(`${KACHELGRENZE_TITEL}.`)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ein neuer neuversuch zeichnet die Kachel neu, ein gleicher nicht', () => {
    const zustand = { wirft: true };
    function Wackelig() {
      if (zustand.wirft) throw new Error('vorübergehend');
      return <span>wieder da</span>;
    }
    const { rerender } = renderMitProviders(
      <KachelGrenze titel="Betroffene" form="gross" neuversuch={1}>
        <Wackelig />
      </KachelGrenze>,
    );
    expect(screen.getByText(`${KACHELGRENZE_TITEL}.`)).toBeInTheDocument();

    zustand.wirft = false;
    rerender(
      <KachelGrenze titel="Betroffene" form="gross" neuversuch={1}>
        <Wackelig />
      </KachelGrenze>,
    );
    expect(screen.queryByText('wieder da')).toBeNull();

    rerender(
      <KachelGrenze titel="Betroffene" form="gross" neuversuch={2}>
        <Wackelig />
      </KachelGrenze>,
    );
    expect(screen.getByText('wieder da')).toBeInTheDocument();
  });
});
