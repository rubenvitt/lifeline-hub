import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import { waehle } from '../test/auswahlListe';
import MaterialAufteilenModal, { type MaterialAufteilenModalProps } from './MaterialAufteilenModal';
import { buildOrtOptions } from './materialOrtWahl';

const POSTEN = {
  id: 10,
  bezeichnung: 'Wolldecke',
  menge: 50,
  ausgegeben: 0,
  einheit_id: 3,
  einsatz_fahrzeug_id: null,
  uhs_id: null,
  br_id: null,
};
const ORT_OPTIONEN = buildOrtOptions({
  einheiten: [{ id: 3, name: 'Staffel A', pfad: 'Staffel A', tiefe: 0, abschnitt: null }],
  uhs: [{ id: 4, bezeichnung: 'Turnhalle', status: 'aktiv', storniert_at: null }],
});

function zeige(p: Partial<MaterialAufteilenModalProps> = {}) {
  const onAufteilen = p.onAufteilen ?? vi.fn().mockResolvedValue(undefined);
  const onSchliessen = p.onSchliessen ?? vi.fn();
  renderMitProviders(
    <MaterialAufteilenModal
      posten={POSTEN}
      ortOptionen={ORT_OPTIONEN}
      laeuft={false}
      speicherung={{ error: null, isPending: false, reset: () => {} }}
      {...p}
      onAufteilen={onAufteilen}
      onSchliessen={onSchliessen}
    />,
  );
  return { onAufteilen, onSchliessen };
}

describe('MaterialAufteilenModal (LLH-1093, design.md D12)', () => {
  it('zeigt das Ergebnis „Danach 30 + 20“ und teilt mit „Aufteilen“ ab', async () => {
    const { onAufteilen, onSchliessen } = zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke aufteilen');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '20');
    expect(await within(dialog).findByTestId('aufteilen-danach')).toHaveTextContent(
      'Danach 30 + 20',
    );
    const knopf = within(dialog).getByRole('button', { name: 'Aufteilen' });
    expect(knopf.closest('form')).not.toBeNull();
    await userEvent.click(knopf);
    // Der Ort bleibt der der Ausgangszeile (t1hvaqzu, design.md D5).
    await waitFor(() => expect(onAufteilen).toHaveBeenCalledWith(20, { art: 'einheit', id: 3 }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('das Feld „Ort“ steht auf dem Ort des Postens (t1hvaqzu, design.md D5)', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog');
    const ort = within(dialog).getByRole('combobox', { name: 'Ort' });
    expect(ort.closest('.ant-select')).toHaveTextContent('Staffel A');
  });

  it('erneut geöffnet mit einem Posten an anderem Ort steht das Feld auf dessen Ort', async () => {
    const onAufteilen = vi.fn().mockResolvedValue(undefined);
    const AN_UHS = { ...POSTEN, id: 11, bezeichnung: 'Feldbett', einheit_id: null, uhs_id: 4 };
    function Rahmen() {
      const [posten, setPosten] = useState<MaterialAufteilenModalProps['posten']>(POSTEN);
      return (
        <>
          <button type="button" onClick={() => setPosten(AN_UHS)}>
            zweiter
          </button>
          <MaterialAufteilenModal
            posten={posten}
            ortOptionen={ORT_OPTIONEN}
            laeuft={false}
            speicherung={{ error: null, isPending: false, reset: () => {} }}
            onAufteilen={onAufteilen}
            onSchliessen={() => setPosten(null)}
          />
        </>
      );
    }
    renderMitProviders(<Rahmen />);
    const erster = await screen.findByRole('dialog', { name: 'Wolldecke aufteilen' });
    await userEvent.click(within(erster).getByRole('button', { name: 'Abbrechen' }));
    // In jsdom endet die Schließanimation nie; der zweite Dialog wird über seinen Titel gefunden.
    await userEvent.click(screen.getByRole('button', { name: 'zweiter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Feldbett aufteilen' });
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    await waitFor(() => expect(onAufteilen).toHaveBeenCalledWith(3, { art: 'uhs', id: 4 }));
  });

  it('20 von 50 an die UHS: die UHS ist das Ziel', async () => {
    const { onAufteilen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '20');
    await waehle('Ort', 'UHS Turnhalle');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    await waitFor(() => expect(onAufteilen).toHaveBeenCalledWith(20, { art: 'uhs', id: 4 }));
  });

  it('„ohne Ort“ ist das Ziel `null`', async () => {
    const { onAufteilen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '20');
    await waehle('Ort', 'ohne Ort');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    await waitFor(() => expect(onAufteilen).toHaveBeenCalledWith(20, null));
  });

  it('die ganze Menge oder mehr lässt sich nicht abteilen', async () => {
    const { onAufteilen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '50');
    expect(within(dialog).queryByTestId('aufteilen-danach')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    expect(await within(dialog).findByText('1 bis 49')).toBeInTheDocument();
    expect(onAufteilen).not.toHaveBeenCalled();
  });

  it('abgeteilt wird nur aus dem Rest; Ausgegebenes bleibt an der Zeile (LLH-1224 D14)', async () => {
    const { onAufteilen } = zeige({
      posten: { ...POSTEN, ausgegeben: 20 },
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('30 von 50 übrig');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' });
    await userEvent.type(feld, '31');
    expect(within(dialog).queryByTestId('aufteilen-danach')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    expect(await within(dialog).findByText('1 bis 30')).toBeInTheDocument();
    expect(onAufteilen).not.toHaveBeenCalled();

    await userEvent.clear(feld);
    await userEvent.type(feld, '30');
    expect(await within(dialog).findByTestId('aufteilen-danach')).toHaveTextContent(
      'Danach 20 + 30',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    await waitFor(() => expect(onAufteilen).toHaveBeenCalledWith(30, { art: 'einheit', id: 3 }));
  });

  it('ohne Menge meldet das Feld den Grund', async () => {
    const { onAufteilen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    expect(await within(dialog).findByText('Menge eintragen')).toBeInTheDocument();
    expect(onAufteilen).not.toHaveBeenCalled();
  });

  it('eine Ablehnung steht im Dialog', async () => {
    zeige({
      speicherung: {
        error: new ApiError(409, 'Material ist nicht mehr im Einsatz'),
        isPending: false,
        reset: () => {},
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/nicht mehr im Einsatz/)).toBeInTheDocument();
  });
});
