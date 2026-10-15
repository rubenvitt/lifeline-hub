import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderMitProviders } from '../test/utils';
import { server } from '../test/server';
import { waehle } from '../test/auswahlListe';
import { ApiError } from '../api/client';
import MaterialUebernahmeModal, {
  type MaterialUebernahmeModalProps,
} from './MaterialUebernahmeModal';

const SANDSAECKE = {
  id: 4,
  art: 'Sandsäcke',
  bezeichnung: 'Sandsäcke Deich Nord',
  anzahl: 2000,
  material_ids: [] as number[],
};

const ohneFehler = { error: null, isPending: false, reset: () => {} };

/** Die Ort-Auswahl lädt ihre Orte wie die Materialliste (LLH-1225). */
function orte() {
  server.use(
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 1, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: null }]),
    ),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
  );
}

function props(p: Partial<MaterialUebernahmeModalProps> = {}): MaterialUebernahmeModalProps {
  return {
    einsatzId: 1,
    nachforderung: SANDSAECKE,
    ergaenzen: false,
    material: [],
    laeuft: false,
    speicherung: ohneFehler,
    onUebernehmen: vi.fn().mockResolvedValue(undefined),
    onSchliessen: vi.fn(),
    ...p,
  };
}

function zeige(p: Partial<MaterialUebernahmeModalProps> = {}) {
  orte();
  const alle = props(p);
  const r = renderMitProviders(<MaterialUebernahmeModal {...alle} />);
  return { ...alle, ...r };
}

describe('MaterialUebernahmeModal (LLH-1226 D10)', () => {
  it('ist vorbelegt: Art aus der Menge, Menge = Anzahl, ohne Ort; der Bedarf steht als Text', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('„Sandsäcke“ als Material übernehmen');
    expect(within(dialog).getByText('Sandsäcke Deich Nord')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Verbrauchsgut' })).toBeChecked();
    expect(within(dialog).getByLabelText('Menge')).toHaveValue('2000');
    expect(within(dialog).getByTitle('ohne Ort')).toBeInTheDocument();
  });

  it('Struktur: drei Felder, der Knopf steht im Formular, kein antd-Fuß', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(3);
    const knopf = within(dialog).getByRole('button', { name: 'Übernehmen' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
  });

  it('sendet Art, Menge und den gewählten Ort', async () => {
    const { onUebernehmen } = zeige();
    await screen.findByRole('dialog');
    await waehle('Ort', 'Staffel A');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(onUebernehmen).toHaveBeenCalledWith({
        art: 'verbrauchsgut',
        menge: 2000,
        ort: 'einheit:1',
      }),
    );
  });

  it('Gerät setzt die Menge fest auf 1', async () => {
    const { onUebernehmen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Gerät' }));
    const menge = within(dialog).getByLabelText('Menge');
    await waitFor(() => expect(menge).toHaveValue('1'));
    expect(menge).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(onUebernehmen).toHaveBeenCalledWith({ art: 'geraet', menge: 1, ort: 'ohne' }),
    );
  });

  it('weiterer Posten: Titel und Knopf nennen ihn, die Menge ist der Rest', async () => {
    zeige({
      ergaenzen: true,
      nachforderung: { ...SANDSAECKE, material_ids: [7] },
      material: [{ id: 7, menge: 1200 }],
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Weiteren Posten „Sandsäcke“ übernehmen');
    expect(within(dialog).getByLabelText('Menge')).toHaveValue('800');
    expect(
      within(dialog).getByRole('button', { name: 'Weiteren Posten übernehmen' }),
    ).toBeInTheDocument();
  });

  it('409: der Dialog bleibt offen, nennt den Grund und wechselt auf „Weiteren Posten übernehmen“ mit neuer Menge', async () => {
    const r = zeige();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Menge')).toHaveValue('2000');
    // Die Seite lädt nach der 409 neu und schaltet die Absicht um (NachforderungenPage).
    r.rerender(
      <MaterialUebernahmeModal
        {...props({
          ergaenzen: true,
          nachforderung: { ...SANDSAECKE, material_ids: [7] },
          material: [{ id: 7, menge: 1200 }],
          speicherung: {
            error: new ApiError(409, 'Aus dieser Nachforderung ist schon Material übernommen'),
            isPending: false,
            reset: () => {},
          },
        })}
      />,
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Aus dieser Nachforderung ist schon Material übernommen',
    );
    expect(screen.getByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Menge')).toHaveValue('800'));
  });

  it('ein Live-Abgleich ändert weder Absicht noch getippte Menge', async () => {
    const r = zeige();
    const dialog = await screen.findByRole('dialog');
    const menge = within(dialog).getByLabelText('Menge');
    await userEvent.clear(menge);
    await userEvent.type(menge, '500');
    r.rerender(
      <MaterialUebernahmeModal
        {...props({
          nachforderung: { ...SANDSAECKE, material_ids: [7] },
          material: [{ id: 7, menge: 1200 }],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeInTheDocument();
    expect(screen.getByLabelText('Menge')).toHaveValue('500');
  });
});
