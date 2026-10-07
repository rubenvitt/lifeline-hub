import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import ZeichnenSteuerung from './ZeichnenSteuerung';

function setup(overrides = {}) {
  const props = {
    aktiv: true,
    titel: 'Gefahrengebiet · Fläche',
    phase: 'zeichnen' as const,
    onAbschliessen: vi.fn(),
    onAbbrechen: vi.fn(),
    onSpeichern: vi.fn(),
    onVerwerfen: vi.fn(),
    ...overrides,
  };
  render(
    <App>
      <ZeichnenSteuerung {...props} />
    </App>,
  );
  return props;
}

describe('ZeichnenSteuerung', () => {
  it('rendert nichts, wenn inaktiv', () => {
    const { container } = render(
      <App>
        <ZeichnenSteuerung
          aktiv={false}
          titel="x"
          phase="zeichnen"
          onAbschliessen={vi.fn()}
          onAbbrechen={vi.fn()}
          onSpeichern={vi.fn()}
          onVerwerfen={vi.fn()}
        />
      </App>,
    );
    expect(container.textContent).not.toContain('Abschließen');
  });

  it('Phase zeichnen: zeigt Titel + Abschließen/Abbrechen, keinen Bediensatz (LFH-1083)', async () => {
    const p = setup();
    expect(screen.getByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/per Klick|doppelklicken|Esc verwirft/);
    await userEvent.click(screen.getByRole('button', { name: 'Abschließen' }));
    expect(p.onAbschliessen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(p.onAbbrechen).toHaveBeenCalledTimes(1);
  });

  it('sperrt Abschließen, solange noch keine drei Punkte gesetzt sind', async () => {
    const p = setup({ abschliessenMoeglich: false });
    const abschliessen = screen.getByRole('button', { name: 'Abschließen' });
    expect(abschliessen).toBeDisabled();
    await userEvent.click(abschliessen);
    expect(p.onAbschliessen).not.toHaveBeenCalled();
  });

  it('Phase bestaetigen: zeigt Speichern/Verwerfen', async () => {
    const p = setup({ phase: 'bestaetigen' });
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(p.onSpeichern).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(p.onVerwerfen).toHaveBeenCalledTimes(1);
  });

  it('Phase bestaetigen mit speichernLaeuft: Speichern zeigt Loading, Verwerfen ist deaktiviert', () => {
    setup({ phase: 'bestaetigen', speichernLaeuft: true });
    // antd Button loading rendert eine Spinner-Struktur; Button bleibt im DOM.
    expect(screen.getByRole('button', { name: /Speichern/ })).toHaveClass('ant-btn-loading');
    // Verwerfen darf während des Speicherns nicht klickbar sein.
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeDisabled();
  });
});

/**
 * Serienmodus: der Schalter existiert nur mit `onSerieWechsel` (das Abschnitt-Zeichnen bekommt
 * keinen), und die Beschriftung des Beenden-Knopfes hängt daran, ob die Serie schon etwas
 * gespeichert hat.
 */
describe('ZeichnenSteuerung — Serienmodus (LFH-332)', () => {
  it('ohne onSerieWechsel (Abschnitt) gibt es keinen Schalter', () => {
    setup();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
  });

  it('mit onSerieWechsel steht der Schalter in BEIDEN Phasen und meldet das Umlegen', async () => {
    const onSerieWechsel = vi.fn();
    setup({ serie: true, onSerieWechsel });
    const schalter = screen.getByRole('switch', { name: 'Weitere zeichnen' });
    expect(schalter).toBeChecked();
    await userEvent.click(schalter);
    expect(onSerieWechsel).toHaveBeenCalledWith(false, expect.anything());
  });

  it('Phase bestaetigen zeigt den Schalter ebenfalls (letzte Gelegenheit vor dem Speichern)', () => {
    setup({ phase: 'bestaetigen', serie: true, onSerieWechsel: vi.fn() });
    expect(screen.getByRole('switch', { name: 'Weitere zeichnen' })).toBeInTheDocument();
  });

  it('ohne gespeichertes Objekt heißt Beenden weiterhin „Abbrechen"', async () => {
    const onFertig = vi.fn();
    const p = setup({ serie: true, onSerieWechsel: vi.fn(), serieAnzahl: 0, onFertig });
    expect(screen.queryByRole('button', { name: 'Fertig' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(p.onAbbrechen).toHaveBeenCalledTimes(1);
    expect(onFertig).not.toHaveBeenCalled();
  });

  it('ab der ersten gespeicherten Zone heißt Beenden „Fertig" und zählt mit', async () => {
    const onFertig = vi.fn();
    const p = setup({ serie: true, onSerieWechsel: vi.fn(), serieAnzahl: 3, onFertig });
    expect(screen.getByText('3 gespeichert')).toBeInTheDocument();
    // „Abbrechen" verwürfe nur einen Entwurf — die drei Zonen bleiben stehen.
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onFertig).toHaveBeenCalledTimes(1);
    expect(p.onAbbrechen).not.toHaveBeenCalled();
  });
});

describe('ZeichnenSteuerung — Platz im KartenFuss (LFH-355)', () => {
  it('positioniert sich nicht selbst, sondern hängt als mittiges Band im Fuß-Rahmen', () => {
    const { container } = render(
      <App>
        <ZeichnenSteuerung
          aktiv
          titel="Gefahrengebiet · Fläche"
          phase="zeichnen"
          onAbschliessen={vi.fn()}
          onAbbrechen={vi.fn()}
          onSpeichern={vi.fn()}
          onVerwerfen={vi.fn()}
        />
      </App>,
    );
    const karte = container.querySelector('.ant-card') as HTMLElement;
    // Die tragende Aussage ist die Abwesenheit: mit `position: absolute` läge die Karte aus dem
    // Fluss, und die SnapshotLeiste verdeckte ihre Knöpfe. Ein fehlendes `position` lässt sich
    // nicht vortäuschen.
    expect(karte.style.position).toBe('');
    expect(karte.style.zIndex).toBe('');
    expect(karte.style.alignSelf).toBe('center');
    expect(karte.style.pointerEvents).toBe('auto');
  });
});

/**
 * Korrigierbares Zeichnen: Knopf und Zähler gibt es nur in der Zeichenphase — nach dem Abschluss
 * ist „Verwerfen" der Weg zurück.
 */
describe('ZeichnenSteuerung — Letzten Punkt zurück und Zähler (LFH-712)', () => {
  it('ohne zurücknehmbaren Punkt gesperrt, mit Punkt frei — als Paar', async () => {
    const onPunktZurueck = vi.fn();
    const { unmount } = render(
      <App>
        <ZeichnenSteuerung
          aktiv
          titel="x"
          phase="zeichnen"
          punkte={0}
          punktZurueckMoeglich={false}
          onPunktZurueck={onPunktZurueck}
          onAbschliessen={vi.fn()}
          onAbbrechen={vi.fn()}
          onSpeichern={vi.fn()}
          onVerwerfen={vi.fn()}
        />
      </App>,
    );
    const gesperrt = screen.getByRole('button', { name: 'Letzten Punkt zurück' });
    expect(gesperrt).toBeDisabled();
    await userEvent.click(gesperrt);
    expect(onPunktZurueck).not.toHaveBeenCalled();
    unmount();

    setup({ punkte: 1, punktZurueckMoeglich: true, onPunktZurueck });
    const frei = screen.getByRole('button', { name: 'Letzten Punkt zurück' });
    expect(frei).toBeEnabled();
    await userEvent.click(frei);
    expect(onPunktZurueck).toHaveBeenCalledTimes(1);
  });

  it('zeigt die Zahl der gesetzten Punkte, Einzahl eigens', () => {
    const { unmount } = render(
      <App>
        <ZeichnenSteuerung
          aktiv
          titel="x"
          phase="zeichnen"
          punkte={1}
          onAbschliessen={vi.fn()}
          onAbbrechen={vi.fn()}
          onSpeichern={vi.fn()}
          onVerwerfen={vi.fn()}
        />
      </App>,
    );
    expect(screen.getByText('1 Punkt')).toBeInTheDocument();
    unmount();
    setup({ punkte: 2 });
    expect(screen.getByText('2 Punkte')).toBeInTheDocument();
  });

  it('Bestätigungsphase: weder Zurück-Knopf noch Zähler', () => {
    setup({ phase: 'bestaetigen', punkte: 3, punktZurueckMoeglich: true, onPunktZurueck: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Letzten Punkt zurück' })).not.toBeInTheDocument();
    expect(screen.queryByText('3 Punkte')).not.toBeInTheDocument();
  });

  it('Esc steht als Kappe am Beenden, solange keine Figur liegt — nicht im Knopfnamen', () => {
    setup({ punkte: 0, punktZurueckMoeglich: false, onPunktZurueck: vi.fn() });
    const abbrechen = screen.getByRole('button', { name: 'Abbrechen' });
    expect(abbrechen).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(abbrechen.querySelector('kbd')).toHaveTextContent('Esc');
    // Nur mit feinem Zeiger sichtbar (Regel in `lagekarte.css`): die Klasse sitzt an der Hülle,
    // weil `Tastenkuerzel` `display` inline setzt und ein Inline-Stil die Regel schlüge.
    const huelle = abbrechen.querySelector('[data-lfh="esc-kappe"]') as HTMLElement;
    expect(huelle).toHaveClass('lfh-nur-feiner-zeiger');
    expect(huelle.style.display).toBe('');
    expect(huelle).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelectorAll('kbd')).toHaveLength(1);
  });

  it('in der Serie trägt „Fertig“ die Kappe, solange keine Figur liegt', () => {
    setup({ punkte: 0, serieAnzahl: 2, onFertig: vi.fn() });
    const fertig = screen.getByRole('button', { name: 'Fertig' });
    expect(fertig).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(fertig.querySelector('kbd')).toHaveTextContent('Esc');
  });

  it('mit Punkten verwirft Esc erst die Figur: keine Kappe am Beenden', () => {
    setup({ punkte: 2 });
    const abbrechen = screen.getByRole('button', { name: 'Abbrechen' });
    expect(abbrechen).not.toHaveAttribute('aria-keyshortcuts');
    expect(document.querySelector('kbd')).toBeNull();
  });

  it('Bestätigungsphase: keine Kappe — Esc verwirft dort nur die Figur, „Verwerfen“ beendet', () => {
    // Esc ruft in der Bestätigung `onBestaetigungZurueck` (Modus bleibt), „Verwerfen“ beendet den
    // Modus (`useKartenInteraktion`): eine Kappe dort behauptete eine Gleichheit, die es nicht gibt.
    setup({ phase: 'bestaetigen' });
    expect(screen.getByRole('button', { name: 'Verwerfen' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
    expect(document.querySelector('kbd')).toBeNull();
    expect(document.body).not.toHaveTextContent(/Entwurf prüfen/);
  });

  it('während des Speicherns keine Kappe: Esc tut dann nichts', () => {
    setup({ punkte: 0, speichernLaeuft: true });
    expect(document.querySelector('kbd')).toBeNull();
  });
});

describe('ZeichnenSteuerung — Stützpunkte (LFH-937)', () => {
  // Beim Polygon zählt der Server den Schlusspunkt mit; die Zeichenphase zählt Ecken. 4 999 Ecken
  // ergeben 5 000 Stützpunkte, 5 000 Ecken schon 5 001.
  it('Fläche in der Zeichenphase: 4 999 Ecken ohne Hinweis, Abschließen frei', () => {
    setup({ punkte: 4_999 });
    expect(screen.queryByText(/zu viele Punkte/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeEnabled();
  });

  it('Fläche in der Zeichenphase: 5 000 Ecken sind mit dem Schlusspunkt zu viele', () => {
    setup({ punkte: 5_000 });
    expect(screen.getByText('zu viele Punkte (höchstens 5.000)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeDisabled();
  });

  it('Linie in der Zeichenphase: 5 000 Punkte frei, 5 001 gesperrt (kein Schlusspunkt)', () => {
    setup({ punkte: 5_000, figur: 'linie', titel: 'Gefahrengebiet · Linie' });
    expect(screen.queryByText(/zu viele Punkte/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeEnabled();
  });

  it('Linie mit 5 001 Punkten ist gesperrt', () => {
    setup({ punkte: 5_001, figur: 'linie', titel: 'Gefahrengebiet · Linie' });
    expect(screen.getByText('zu viele Punkte (höchstens 5.000)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeDisabled();
  });

  it('in der Bestätigung zählen die Stützpunkte des Entwurfs: 5 000 frei', () => {
    setup({ phase: 'bestaetigen', punkte: 5_000 });
    expect(screen.queryByText(/zu viele Punkte/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled();
  });

  it('über der Grenze: Hinweis neben dem Zähler mit Zeichen, Abschließen gesperrt', () => {
    setup({ punkte: 5_001 });
    const hinweis = screen.getByText('zu viele Punkte (höchstens 5.000)');
    const zeile = screen.getByText('5.001 Punkte').parentElement!;
    expect(zeile.contains(hinweis)).toBe(true);
    // Zweiter Kanal neben der Farbe: ein Zeichen vor dem Wort.
    expect(hinweis.closest('[data-lfh="zeichnen-zu-viele"]')?.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeDisabled();
  });

  it('in der Bestätigung sperrt eine zu große Figur das Speichern', () => {
    setup({ phase: 'bestaetigen', punkte: 5_001 });
    expect(screen.getByText('zu viele Punkte (höchstens 5.000)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });
});
