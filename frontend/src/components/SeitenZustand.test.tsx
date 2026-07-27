import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { SeitenFehler, SeitenSkeleton } from './SeitenZustand';

describe('SeitenSkeleton', () => {
  it('meldet sich als beschäftigt und rendert Skelettbalken statt eines Lade-Textes', () => {
    const { container } = renderMitProviders(<SeitenSkeleton />);

    const skelett = container.querySelector('[aria-busy="true"]');
    expect(skelett).not.toBeNull();
    // Kein „Laden…"-Textduplikat: die Ansage steckt im aria-label, nicht als
    // zweiter sichtbarer Text daneben.
    expect(screen.queryByText(/laden/i)).not.toBeInTheDocument();
    expect(skelett).toHaveAttribute('aria-label', expect.stringMatching(/wird geladen/i));
  });

  it('trägt die Skelett-Klassen der Gestaltungssprache (Höhe kommt aus `sprache.css`)', () => {
    // jsdom rechnet kein Layout — die Balkenhöhe ist im Test nicht messbar. Geprüft
    // wird deshalb der Vertrag zur Stylesheet-Seite: ohne diese Klassen (und ohne den
    // `sprache.css`-Import der Komponente) sind die Balken 0 px hoch und die Seite bleibt
    // beim Laden leer.
    const { container } = renderMitProviders(<SeitenSkeleton />);

    expect(container.querySelector('.lfh-skelett')).not.toBeNull();
    expect(container.querySelectorAll('.lfh-skelett__balken').length).toBeGreaterThan(0);
  });

  it('rendert so viele Balken wie angefordert', () => {
    const { container } = renderMitProviders(<SeitenSkeleton zeilen={5} />);

    expect(container.querySelectorAll('.lfh-skelett__balken')).toHaveLength(5);
  });
});

describe('SeitenFehler', () => {
  it('rendert den Text als Meldung mit role="alert"', () => {
    renderMitProviders(<SeitenFehler text="Einsatz nicht gefunden oder kein Zugriff" />);

    const meldung = screen.getByRole('alert');
    expect(meldung).toHaveTextContent('Einsatz nicht gefunden oder kein Zugriff');
  });

  it('zeigt ohne `onWiederholen` keinen Knopf', () => {
    renderMitProviders(<SeitenFehler text="Kaputt" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('feuert `onWiederholen` beim Klick auf „Erneut abrufen"', async () => {
    const wiederholen = vi.fn();
    renderMitProviders(<SeitenFehler text="Kaputt" onWiederholen={wiederholen} />);

    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));

    expect(wiederholen).toHaveBeenCalledTimes(1);
  });
});
