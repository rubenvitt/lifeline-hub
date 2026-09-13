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

  it('Phase zeichnen: zeigt Titel + Hinweis + Abschließen/Abbrechen', async () => {
    const p = setup();
    expect(screen.getByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
    expect(screen.getByText(/Punkte per Klick setzen/i)).toBeInTheDocument();
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
    // M-B (Review-Fix): Verwerfen darf während des Speicherns nicht klickbar sein.
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeDisabled();
  });
});

/**
 * Serienmodus (LFH-332/M76). Der Zonen-Modus brach nach jedem gespeicherten Objekt ab.
 *
 * Die Komponente trägt hier zwei Zustände, die beide belegt sein müssen: der Schalter
 * existiert NUR, wenn ein `onSerieWechsel` gereicht wird (Abschnitt-Zeichnen bekommt keinen —
 * die vier Fälle oben laufen deshalb unverändert), und die Beschriftung des Beenden-Knopfes
 * hängt daran, ob die Serie schon etwas gespeichert hat.
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
    // Die tragende Aussage ist die ABWESENHEIT: mit `position: absolute` läge die Karte
    // wieder aus dem Fluss und die später gerenderte SnapshotLeiste verdeckte ihre Knöpfe
    // (gemessen als Playwright-Timeout „intercepts pointer events", während `toBeVisible()`
    // grün blieb). Ein niedriger `zIndex` liesse sich vortäuschen, ein fehlendes
    // `position` nicht.
    expect(karte.style.position).toBe('');
    expect(karte.style.zIndex).toBe('');
    expect(karte.style.alignSelf).toBe('center');
    expect(karte.style.pointerEvents).toBe('auto');
  });
});
