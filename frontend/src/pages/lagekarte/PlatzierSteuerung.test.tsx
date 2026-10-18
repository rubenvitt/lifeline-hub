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

  it('Platzieren: Objekt im Titel, kein Bediensatz, „Abbrechen" beendet', async () => {
    const onAbbrechen = vi.fn();
    zeige({ art: 'platzieren', objekt: 'Einheit: Pumpe Ost', onAbbrechen });
    expect(screen.getByText('Platzieren · Einheit: Pumpe Ost')).toBeInTheDocument();
    // Fadenkreuz und Titel zeigen den Modus; ein Satz „Tipp auf die Karte …“ fällt weg (LFH-1083).
    expect(document.body).not.toHaveTextContent(/Tipp auf die Karte/);
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

describe('PlatzierSteuerung — Rückmeldung „verortet“ (LLH-1125)', () => {
  it('mit Herkunft: Kennung im Titel, „Zurück zu …“ primär, „Auf der Karte bleiben“ daneben', async () => {
    const onZurueck = vi.fn();
    const onBleiben = vi.fn();
    zeige({ art: 'verortet', meldung: { kennung: 'R-005', onZurueck, onBleiben } });
    expect(screen.getByText('R-005 verortet')).toBeInTheDocument();
    const zurueck = screen.getByRole('button', { name: 'Zurück zu R-005' });
    expect(zurueck).toHaveClass('ant-btn-primary');
    // Genau zwei Knöpfe, je Handlung einer.
    expect(screen.getAllByRole('button')).toHaveLength(2);
    await userEvent.click(zurueck);
    expect(onZurueck).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Auf der Karte bleiben' }));
    expect(onBleiben).toHaveBeenCalledTimes(1);
  });

  it('ohne Herkunft kein Rückweg, ohne Kennung „Objekt verortet“ und „Zurück“', () => {
    const { rerender } = zeige({
      art: 'verortet',
      meldung: { kennung: 'R-005', onZurueck: null, onBleiben: vi.fn() },
    });
    expect(screen.queryByRole('button', { name: /^Zurück/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auf der Karte bleiben' })).toBeInTheDocument();

    rerender(
      <PlatzierSteuerung
        modus={{
          art: 'verortet',
          meldung: { kennung: null, onZurueck: vi.fn(), onBleiben: vi.fn() },
        }}
      />,
    );
    expect(screen.getByText('Objekt verortet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeInTheDocument();
  });
});
