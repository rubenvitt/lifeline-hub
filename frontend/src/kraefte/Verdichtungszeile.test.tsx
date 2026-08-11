import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { renderMitProviders } from '../test/utils';
import Verdichtungszeile from './Verdichtungszeile';
import { kraefteuebersichtPfad } from '../routing/deeplinks';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';

vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));

beforeEach(() => {
  vi.mocked(listeEinsatzPersonal).mockResolvedValue([]);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([]);
});

function setup() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/fahrzeuge" element={<Verdichtungszeile einsatzId={1} pfad={kraefteuebersichtPfad(1)} />} />
    </Routes>,
    { route: '/einsaetze/1/fahrzeuge' },
  );
}

/**
 * Die Führungsantwort im Kopf einer Kräfte-Modulseite (LFH-338 · C3, Befund H21).
 *
 * Die aggregierende Kräfteübersicht war von KEINER der vier Modulseiten verlinkt. Wer auf
 * der Fahrzeugseite stand und die Gesamtstärke brauchte, musste sie über die Modulnavigation
 * suchen — die Verdichtung, für die es eine eigene Seite gibt, war von der Pflegefläche aus
 * unsichtbar.
 */
describe('Verdichtungszeile', () => {
  it('zeigt Stärke und Fahrzeugverfügbarkeit und verlinkt auf die Kräfteübersicht', async () => {
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([
      { staerke_position: 'fuehrer', status_kategorie: 'gebunden' },
      { staerke_position: 'mannschaft', status_kategorie: 'gebunden' },
    ] as never);
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([
      { status_kategorie: 'verfuegbar' },
      { status_kategorie: 'gebunden' },
    ] as never);
    setup();

    // BOS-Schreibweise mit Doppelstrich vor der Gesamtstärke.
    expect(await screen.findByText('1/0/1//2')).toBeInTheDocument();
    // Die Farbe ist der zweite Kanal, nicht der einzige: jede Zahl trägt ihr Wort.
    expect(screen.getByText('1 frei')).toBeInTheDocument();
    expect(screen.getByText('1 gebunden')).toBeInTheDocument();
    expect(screen.getByText('0 n. verf.')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Kräfteübersicht/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/kraefteuebersicht',
    );
  });

  it('bleibt bei gescheitertem Abruf stumm, statt eine Null zu behaupten', async () => {
    vi.mocked(listeEinsatzFahrzeuge).mockRejectedValue(new Error('kaputt'));
    const { container } = setup();

    /**
     * „0/0/0//0" auf einer Führungsfläche liest sich wie eine Meldung und ist keine. Ein
     * Nullwert im Fehlerfall wäre schlimmer als gar keine Angabe: er sähe aus wie „keine
     * Kräfte im Einsatz", während in Wahrheit nur der Abruf scheiterte.
     */
    await vi.waitFor(() => expect(container.textContent).not.toContain('Stärke'));
    expect(container.textContent).not.toContain('0/0/0//0');
  });

  it('zeigt nichts, solange die Listen noch nicht da sind', () => {
    // Kein Skelett und keine Null: die Zeile ist ein Zusatz im Kopf einer Pflegeseite,
    // kein eigener Seiteninhalt. Ein Platzhalter, der eine Zeile hoch ein- und ausblendet,
    // verschöbe die Tabelle darunter bei jedem Laden (Prüflisten-Kriterium 12, CLS).
    const { container } = setup();
    expect(container.textContent).toBe('');
  });
});
