import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlatzierSteuerung, { type PlatzierModus } from './PlatzierSteuerung';

function zeige(modus: PlatzierModus | null) {
  return render(<PlatzierSteuerung modus={modus} />);
}

describe('PlatzierSteuerung (LFH-765)', () => {
  it('ohne Modus rendert sie nichts', () => {
    const { container } = zeige(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('Platzieren: Objekt im Titel, Hinweis, „Abbrechen" beendet', async () => {
    const onAbbrechen = vi.fn();
    zeige({ art: 'platzieren', objekt: 'Einheit: Pumpe Ost', onAbbrechen });
    expect(screen.getByText('Platzieren · Einheit: Pumpe Ost')).toBeInTheDocument();
    expect(screen.getByText('Tipp auf die Karte setzt die Position.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalledTimes(1);
  });

  it('Taktisches Zeichen: vor dem ersten Zeichen „Abbrechen", kein „Fertig", kein Zähler', async () => {
    const onAbbrechen = vi.fn();
    const onFertig = vi.fn();
    zeige({
      art: 'zeichen',
      serie: false,
      onSerieWechsel: vi.fn(),
      anzahl: 0,
      onAbbrechen,
      onFertig,
    });
    expect(screen.getByText('Taktisches Zeichen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fertig' })).not.toBeInTheDocument();
    expect(screen.queryByText(/platziert$/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalledTimes(1);
    expect(onFertig).not.toHaveBeenCalled();
  });

  it('Taktisches Zeichen: ab dem ersten Zeichen „Fertig" mit Zähler, kein „Abbrechen"', async () => {
    const onFertig = vi.fn();
    zeige({
      art: 'zeichen',
      serie: true,
      onSerieWechsel: vi.fn(),
      anzahl: 2,
      onAbbrechen: vi.fn(),
      onFertig,
    });
    expect(screen.getByText('2 platziert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onFertig).toHaveBeenCalledTimes(1);
  });

  it('Taktisches Zeichen: der Schalter „Weitere platzieren" meldet den Wechsel', async () => {
    const onSerieWechsel = vi.fn();
    zeige({
      art: 'zeichen',
      serie: false,
      onSerieWechsel,
      anzahl: 0,
      onAbbrechen: vi.fn(),
      onFertig: vi.fn(),
    });
    const schalter = screen.getByRole('switch', { name: 'Weitere platzieren' });
    expect(schalter).not.toBeChecked();
    await userEvent.click(schalter);
    expect(onSerieWechsel).toHaveBeenCalledWith(true, expect.anything());
  });

  it('Bild: Name im Titel, Griffwahl meldet den Wechsel, „Fertig" beendet', async () => {
    const onGriffModus = vi.fn();
    const onFertig = vi.fn();
    zeige({ art: 'bild', name: 'Lageplan', griffModus: 'groesse', onGriffModus, onFertig });
    expect(screen.getByText('Bild einpassen · Lageplan')).toBeInTheDocument();
    const griffe = screen.getByRole('radiogroup', { name: 'Griffe auf der Karte' });
    expect(griffe).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Drehen' }));
    expect(onGriffModus).toHaveBeenCalledWith('drehen');
    await userEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onFertig).toHaveBeenCalledTimes(1);
  });

  it('trägt die Marke des Bands, damit Fuß-Messungen es finden', () => {
    const { container } = zeige({
      art: 'platzieren',
      objekt: 'Einsatzort',
      onAbbrechen: vi.fn(),
    });
    expect(container.querySelector('[data-lfh="platzier-steuerung"]')).not.toBeNull();
  });
});
