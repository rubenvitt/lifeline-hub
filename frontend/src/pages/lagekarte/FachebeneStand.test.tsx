import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import FachebeneStand from './FachebeneStand';

// Ortszeit statt UTC-Literal: die Anzeige folgt der Browserzone, der Test soll in jeder Zone gelten.
const ortszeit = (tag: number, stunde: number, minute: number) =>
  new Date(2026, 8, tag, stunde, minute).toISOString();

describe('FachebeneStand (LFH-591)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function jetztIst(tag: number, stunde: number, minute: number) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, tag, stunde, minute));
  }

  it('zeigt einen Stand von heute als Uhrzeit', () => {
    jetztIst(30, 14, 40);
    renderMitProviders(<FachebeneStand quelle="hochwasser" abgerufen={ortszeit(30, 14, 30)} />);
    const stand = screen.getByText(/Stand/).closest('[data-lfh="fachebene-stand"]')!;
    expect(stand).toHaveTextContent(/^Stand 1430$/);
    expect(stand).not.toHaveAttribute('data-veraltet');
  });

  it('zeigt einen Stand von einem Vortag mit Tag', () => {
    jetztIst(30, 10, 0);
    // KRITIS: 20 h sind weit unter der Schwelle, der Vortag allein macht nichts veraltet.
    renderMitProviders(<FachebeneStand quelle="kritis" abgerufen={ortszeit(29, 14, 30)} />);
    expect(screen.getByText(/Stand/).closest('[data-lfh="fachebene-stand"]')).toHaveTextContent(
      /^Stand 291430$/,
    );
    expect(screen.queryByText(/veraltet/)).not.toBeInTheDocument();
  });

  it('kennzeichnet einen Stand jenseits der Schwelle mit dem Wort, nicht nur mit Farbe', () => {
    jetztIst(30, 10, 0);
    // Hochwasser vor 40 h — der Anlass des Tickets.
    renderMitProviders(<FachebeneStand quelle="hochwasser" abgerufen={ortszeit(28, 18, 0)} />);
    const stand = screen.getByText(/veraltet/).closest('[data-lfh="fachebene-stand"]')!;
    expect(stand).toHaveAttribute('data-veraltet', 'true');
    // Das Wort steht im zugänglichen Text; das Zeichen ist stumm.
    expect(stand).toHaveTextContent(/veraltet · Stand 281800$/);
    expect(stand.querySelector('[aria-hidden="true"]')).toHaveTextContent('⧖');
  });

  it('wird ohne neuen Abruf veraltet, sobald die Zeit die Schwelle überschreitet', () => {
    jetztIst(30, 14, 29);
    // 59 min alt bei 60 min Schwelle.
    renderMitProviders(<FachebeneStand quelle="hochwasser" abgerufen={ortszeit(30, 13, 30)} />);
    expect(screen.queryByText(/veraltet/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText(/veraltet/)).toBeInTheDocument();
  });

  it('volle Form nennt die DTG mit Monat und Jahr', () => {
    jetztIst(30, 14, 40);
    renderMitProviders(
      <FachebeneStand quelle="hochwasser" abgerufen={ortszeit(30, 14, 30)} form="voll" />,
    );
    expect(screen.getByText(/Stand/).closest('[data-lfh="fachebene-stand"]')).toHaveTextContent(
      /^Stand 301430SEP2026$/,
    );
  });

  it('ohne Abrufzeitpunkt steht nichts da', () => {
    const { container } = renderMitProviders(<FachebeneStand quelle="dwd" abgerufen={undefined} />);
    expect(container.querySelector('[data-lfh="fachebene-stand"]')).toBeNull();
  });
});
