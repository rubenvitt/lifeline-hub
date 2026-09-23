import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import MessSteuerung from './MessSteuerung';
import { erzeugeMessQuelle } from './messQuelle';

function rendere(form: 'strecke' | 'flaeche' | null = 'strecke') {
  const quelle = erzeugeMessQuelle();
  const p = {
    form,
    quelle,
    onForm: vi.fn(),
    onAbschliessen: vi.fn(),
    onNeu: vi.fn(),
    onBeenden: vi.fn(),
  };
  renderMitProviders(<MessSteuerung {...p} />);
  return p;
}

const STRECKE = {
  type: 'LineString',
  coordinates: [
    [9, 52],
    [9, 52.001],
  ],
};

describe('MessSteuerung (LFH-616)', () => {
  it('rendert nichts, solange nicht gemessen wird', () => {
    rendere(null);
    expect(document.querySelector('[data-lfh="mess-steuerung"]')).toBeNull();
  });

  it('zeigt den laufenden Wert aus der Quelle und gibt „Abschließen" erst dann frei', () => {
    const p = rendere();
    const wert = () => document.querySelector('[data-lfh="messwert"]')!;
    expect(wert()).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeDisabled();

    act(() => p.quelle.melde({ geometrie: STRECKE, fertig: false }));
    expect(wert()).toHaveTextContent('111 m');
    fireEvent.click(screen.getByRole('button', { name: 'Abschließen' }));
    expect(p.onAbschliessen).toHaveBeenCalledTimes(1);
  });

  it('nach dem Abschluss: „Neu messen" statt „Abschließen", Beenden bleibt', () => {
    const p = rendere();
    act(() => p.quelle.melde({ geometrie: STRECKE, fertig: true }));
    expect(screen.queryByRole('button', { name: 'Abschließen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Neu messen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Beenden' }));
    expect(p.onNeu).toHaveBeenCalledTimes(1);
    expect(p.onBeenden).toHaveBeenCalledTimes(1);
  });

  it('wechselt die Form über die Segmentleiste und zeigt bei der Fläche den Umfang', () => {
    const p = rendere('flaeche');
    fireEvent.click(screen.getByRole('radio', { name: 'Strecke' }));
    expect(p.onForm).toHaveBeenCalledWith('strecke');
    act(() =>
      p.quelle.melde({
        geometrie: {
          type: 'Polygon',
          coordinates: [
            [
              [9, 52],
              [9.001, 52],
              [9.001, 52.001],
              [9, 52],
            ],
          ],
        },
        fertig: false,
      }),
    );
    expect(document.querySelector('[data-lfh="messwert"]')).toHaveTextContent(/m².*Umfang/);
  });
});
