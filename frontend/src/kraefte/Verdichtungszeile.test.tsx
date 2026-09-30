import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { renderMitProviders } from '../test/utils';
import Verdichtungszeile, {
  verdichtungsLinkStil,
  verdichtungsTextfarbe,
} from './Verdichtungszeile';
import { dichten, farbenDunkel, farbenHell } from '../theme/tokens';
import { statusKategorie } from '../theme/statusFarben';
import { kraefteuebersichtPfad } from '../routing/deeplinks';
import { einsatzKeys } from '../api/queryKeys';
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
      <Route
        path="/einsaetze/:id/fahrzeuge"
        element={<Verdichtungszeile einsatzId={1} pfad={kraefteuebersichtPfad(1)} />}
      />
    </Routes>,
    { route: '/einsaetze/1/fahrzeuge' },
  );
}

/** Die Führungsantwort im Kopf einer Kräfte-Modulseite. */
describe('Verdichtungszeile', () => {
  it('zeigt Stärke und Fahrzeugverfügbarkeit und verlinkt auf das Meldebild', async () => {
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

    // Der Linktext folgt dem Seitennamen „Meldebild"; die Route bleibt `kraefteuebersicht`.
    expect(screen.getByRole('link', { name: 'Meldebild' })).toHaveAttribute(
      'href',
      '/einsaetze/1/kraefteuebersicht',
    );
    expect(screen.queryByRole('link', { name: /Kräfteübersicht/ })).toBeNull();
  });

  it('bleibt beim ERSTEN gescheiterten Abruf stumm, statt eine Null zu behaupten', async () => {
    vi.mocked(listeEinsatzFahrzeuge).mockRejectedValue(new Error('kaputt'));
    const { container } = setup();

    /**
     * „0/0/0//0" sähe aus wie „keine Kräfte im Einsatz". Diese Zusicherung allein belegt den
     * Fehlerzweig nicht (ohne Daten ist auch der Ladezweig still); das trägt der Test darunter.
     */
    await vi.waitFor(() => expect(container.textContent).not.toContain('Stärke'));
    expect(container.textContent).not.toContain('0/0/0//0');
  });

  it('lässt die zuletzt bekannten Zahlen stehen, wenn erst der ZWEITE Abruf scheitert', async () => {
    /**
     * Der häufigere Fall: die Zahlen stehen, ein Folgeabruf scheitert. Verschwände die Zeile,
     * spränge die Tabelle darunter unter dem Cursor. Die Zahlen sind echt, nur womöglich alt.
     */
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([
      { staerke_position: 'fuehrer', status_kategorie: 'gebunden' },
    ] as never);
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([
      { status_kategorie: 'verfuegbar' },
    ] as never);
    const { client } = setup();
    expect(await screen.findByText('1/0/0//1')).toBeInTheDocument();

    vi.mocked(listeEinsatzFahrzeuge).mockRejectedValue(new Error('kaputt'));
    await client.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(1) });

    // Gewartet wird auf den FEHLERZUSTAND im Cache, nicht auf die Zahl der Aufrufe — direkt nach
    // dem Aufruf ist der Fehler noch nicht propagiert.
    await vi.waitFor(() =>
      expect(client.getQueryState(einsatzKeys.fahrzeuge(1))?.status).toBe('error'),
    );
    // …und EINEN Tick, damit React den Fehlerzustand gerendert hat.
    await new Promise((weiter) => setTimeout(weiter, 0));
    expect(screen.getByText('1/0/0//1')).toBeInTheDocument();
  });

  it('zeigt nichts, solange die Listen noch nicht da sind', () => {
    // Kein Skelett und keine Null: ein ein- und ausblendender Platzhalter verschöbe die Tabelle
    // darunter bei jedem Laden.
    const { container } = setup();
    expect(container.textContent).toBe('');
  });
});

/**
 * Der Link als Bedienziel auf der Dichte-Staffel. Hier nur der Inline-Stil: ohne Theme und
 * Layout bewiese ein Pixel nichts; die Pixel misst `e2e/gate3-trefflaeche.spec.ts`.
 */
describe('Meldebild-Link — Bedienziel auf der Dichte-Staffel (LFH-515)', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingSM: dichten[stufe].abstand.sm,
  });

  // Die Böden als Literale, sonst prüfte der Test den Token gegen sich selbst.
  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(verdichtungsLinkStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(verdichtungsLinkStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(verdichtungsLinkStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const hoehen = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => verdichtungsLinkStil(tokenFuer(s)).minHeight,
    );
    expect(hoehen[0]).toBeLessThan(hoehen[1]);
    expect(hoehen[1]).toBeLessThan(hoehen[2]);
  });

  /** ZWEI Angaben, und die Polsterung liegt auf BEIDEN Achsen (hier polstert niemand sonst). */
  it('trägt neben der Höhe eine mitziehende Polsterung auf beiden Achsen', () => {
    expect(verdichtungsLinkStil(tokenFuer('kompakt')).padding).toBe('7px');
    expect(verdichtungsLinkStil(tokenFuer('handschuh')).padding).toBe('16px');
  });

  /** `inline-flex`: ein `flex` risse den Link auf volle Breite. */
  it('bleibt ein Inline-Glied der Zeile', () => {
    expect(verdichtungsLinkStil(tokenFuer('kompakt')).display).toBe('inline-flex');
  });
});

/**
 * LFH-538: die drei Statuszahlen stehen als TEXT auf Seitengrund (`grund`). Die Füllrollen
 * `normal`/`achtung`/`alarm` tragen dort den Tagesboden nicht (gemessen 5,80 / 5,78 / 5,66),
 * deshalb die Textrollen. GERECHNET statt behauptet (WCAG-Formel), Böden aus Kriterium 5 als
 * Literale: Tag ≥ 7, Nacht ≥ 5.
 */
describe('Verdichtungszeile — Kontrast der Statuszahlen (LFH-538)', () => {
  function luminanz(hex: string): number {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => {
      const s = Number.parseInt(h.slice(i, i + 2), 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function kontrast(a: string, b: string): number {
    const [x, y] = [luminanz(a), luminanz(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  const KATEGORIEN = ['verfuegbar', 'gebunden', 'nicht_verfuegbar'] as const;

  it.each(KATEGORIEN)('%s hält am Tag ≥ 7 : 1 auf Seitengrund', (kategorie) => {
    const farbe = verdichtungsTextfarbe(farbenHell, statusKategorie[kategorie].rolle);
    expect(kontrast(farbe, farbenHell.grund)).toBeGreaterThanOrEqual(7);
  });

  it.each(KATEGORIEN)('%s hält nachts ≥ 5 : 1 auf Seitengrund', (kategorie) => {
    const farbe = verdichtungsTextfarbe(farbenDunkel, statusKategorie[kategorie].rolle);
    expect(kontrast(farbe, farbenDunkel.grund)).toBeGreaterThanOrEqual(5);
  });

  it('die drei Rollen bleiben unterscheidbar (die Farbe ist ein Kanal, nicht Deko)', () => {
    const farben = KATEGORIEN.map((k) =>
      verdichtungsTextfarbe(farbenHell, statusKategorie[k].rolle),
    );
    expect(new Set(farben).size).toBe(3);
  });

  it('die gerenderte Zeile färbt mit genau dieser Textfarbe, nicht mit der Füllrolle', async () => {
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([
      { status_kategorie: 'verfuegbar' },
      { status_kategorie: 'gebunden' },
      { status_kategorie: 'nicht_verfuegbar' },
    ] as never);
    setup();
    // `test/utils` rendert ein nacktes (helles) Theme — also die Tagespalette.
    for (const [text, kategorie] of [
      ['1 frei', 'verfuegbar'],
      ['1 gebunden', 'gebunden'],
      ['1 n. verf.', 'nicht_verfuegbar'],
    ] as const) {
      expect(await screen.findByText(text)).toHaveStyle({
        color: verdichtungsTextfarbe(farbenHell, statusKategorie[kategorie].rolle),
      });
    }
  });
});
