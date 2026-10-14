import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import MaterialAngabenModal, {
  geaenderteAngaben,
  type MaterialAngabenModalProps,
} from './MaterialAngabenModal';

const posten = {
  id: 10,
  bezeichnung: 'Feldbeten',
  kategorie: null,
  traegerorganisation: 'THW',
  bestandsnummer: 'B-1',
};

function zeige(p: Partial<MaterialAngabenModalProps> = {}) {
  const onSpeichern = p.onSpeichern ?? vi.fn().mockResolvedValue(undefined);
  const onSchliessen = p.onSchliessen ?? vi.fn();
  renderMitProviders(
    <MaterialAngabenModal
      posten={posten}
      laeuft={false}
      speicherung={{ error: null, isPending: false, reset: () => {} }}
      {...p}
      onSpeichern={onSpeichern}
      onSchliessen={onSchliessen}
    />,
  );
  return { onSpeichern, onSchliessen };
}

describe('geaenderteAngaben (LLH-1093, design.md D12)', () => {
  it('schickt nur Geändertes, geleert als null, getrimmt verglichen', () => {
    expect(
      geaenderteAngaben(posten, {
        bezeichnung: ' Feldbetten ',
        kategorie: 'Betreuung',
        traegerorganisation: 'THW ',
        bestandsnummer: '',
      }),
    ).toEqual({ bezeichnung: 'Feldbetten', kategorie: 'Betreuung', bestandsnummer: null });
    expect(
      geaenderteAngaben(posten, {
        bezeichnung: 'Feldbeten',
        kategorie: '',
        traegerorganisation: 'THW',
        bestandsnummer: 'B-1',
      }),
    ).toEqual({});
  });
});

describe('MaterialAngabenModal', () => {
  it('ist mit den Angaben vorbelegt; die Bestandsnummer liegt unter „Weitere Angaben“', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Angaben zu Feldbeten ändern');
    expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue('Feldbeten');
    expect(within(dialog).getByLabelText('Kategorie')).toHaveValue('');
    expect(within(dialog).getByLabelText('Trägerorganisation')).toHaveValue('THW');
    expect(within(dialog).getByLabelText('Bestandsnummer')).not.toBeVisible();
    // Der Kopf des Klappteils nennt den Wert darin.
    expect(
      within(dialog).getByRole('button', { name: /Weitere Angaben · Bestandsnummer B-1/ }),
    ).toBeInTheDocument();
  });

  it('sendet nur die geänderten Angaben und schließt', async () => {
    const { onSpeichern, onSchliessen } = zeige();
    const dialog = await screen.findByRole('dialog');
    const bezeichnung = within(dialog).getByLabelText('Bezeichnung');
    await userEvent.clear(bezeichnung);
    await userEvent.type(bezeichnung, 'Feldbetten');
    await userEvent.type(within(dialog).getByLabelText('Kategorie'), 'Betreuung');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onSpeichern).toHaveBeenCalledWith({
        bezeichnung: 'Feldbetten',
        kategorie: 'Betreuung',
      }),
    );
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('ohne Änderung sendet nichts', async () => {
    const { onSpeichern, onSchliessen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('eine leere Bezeichnung meldet das Feld und sendet nichts', async () => {
    const { onSpeichern } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Bezeichnung'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Bezeichnung eintragen')).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('eine zu lange Angabe wird nicht gekürzt und sperrt das Senden', async () => {
    const lang = 'x'.repeat(201);
    const { onSpeichern } = zeige({ posten: { ...posten, kategorie: lang } });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Kategorie')).toHaveValue(lang);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText('Kategorie darf höchstens 200 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('eine zu lange Bestandsnummer klappt ihren Teil auf', async () => {
    const { onSpeichern } = zeige({ posten: { ...posten, bestandsnummer: 'y'.repeat(201) } });
    const dialog = await screen.findByRole('dialog');
    const kopf = within(dialog).getByRole('button', { name: /Weitere Angaben/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(kopf).toHaveAttribute('aria-expanded', 'true'));
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('eine Ablehnung steht im Dialog', async () => {
    zeige({
      speicherung: {
        error: new ApiError(422, 'Angaben eines Stamm-Postens im Stamm pflegen'),
        isPending: false,
        reset: () => {},
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/im Stamm pflegen/)).toBeInTheDocument();
  });
});
