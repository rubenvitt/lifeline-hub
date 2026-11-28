import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MeldungVorschlaege from './MeldungVorschlaege';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import type { ReportSuggestion } from '../api/types';

const listeMeldungVorschlaege = vi.fn();
const uebernehmeMeldungVorschlag = vi.fn();
const verwirfMeldungVorschlag = vi.fn();
const legeMeldungAn = vi.fn();
vi.mock('../api/meldungen', () => ({
  legeMeldungAn: (...a: unknown[]) => legeMeldungAn(...a),
  listeMeldungVorschlaege: (...a: unknown[]) => listeMeldungVorschlaege(...a),
  uebernehmeMeldungVorschlag: (...a: unknown[]) => uebernehmeMeldungVorschlag(...a),
  verwirfMeldungVorschlag: (...a: unknown[]) => verwirfMeldungVorschlag(...a),
}));

const NORD: ReportSuggestion = {
  id: 11,
  text: 'Abschnitt Nord: 2 Verletzte, brauchen RTW',
  source: { adapter: 'meshtastic', sender_id: '!a1b2c3d4', sender_name: 'Nord-1', signed: false },
  sent_at: '2026-11-28 08:41:00',
  received_at: '2026-11-28 08:41:30',
};
const BRUECKE: ReportSuggestion = {
  id: 12,
  text: 'Wasserstand Brücke steigt',
  source: { adapter: 'meshtastic', sender_id: '!77ee01ff', signed: true },
  sent_at: null,
  received_at: '2026-11-28 08:44:10',
};

beforeEach(() => {
  listeMeldungVorschlaege.mockReset().mockResolvedValue([NORD, BRUECKE]);
  uebernehmeMeldungVorschlag.mockReset().mockResolvedValue({ id: 99, lfd_nr: 5 });
  verwirfMeldungVorschlag.mockReset().mockResolvedValue(undefined);
  legeMeldungAn.mockReset().mockResolvedValue({ id: 100, lfd_nr: 6 });
});

describe('Vorschläge im Meldungseingang (LLH-2112)', () => {
  it('zeigt nichts ohne offene Vorschläge', async () => {
    listeMeldungVorschlaege.mockResolvedValue([]);
    const { container } = renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben />);
    await waitFor(() => expect(listeMeldungVorschlaege).toHaveBeenCalledWith(7));
    // Die Hülle von antds `App` bleibt; darin steht nichts.
    expect(container.querySelector('.ant-app')).toBeEmptyDOMElement();
  });

  it('nennt Zahl, Wortlaut und Herkunft', async () => {
    renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben />);
    expect(
      await screen.findByRole('heading', { name: 'Vorschläge · unverifiziert (2)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Abschnitt Nord: 2 Verletzte, brauchen RTW')).toBeInTheDocument();
    expect(
      screen.getByText('Mesh · Knoten „Nord-1“ (!a1b2c3d4) · nicht signiert'),
    ).toBeInTheDocument();
    expect(screen.getByText('Mesh · Knoten !77ee01ff · signiert')).toBeInTheDocument();
  });

  it('übernimmt einen Vorschlag über das vorbelegte Meldungsformular', async () => {
    renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben />);
    const knoepfe = await screen.findAllByRole('button', { name: 'Als Meldung übernehmen' });
    await userEvent.click(knoepfe[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Inhalt / Wortlaut')).toHaveValue(NORD.text);
    expect(within(dialog).getByLabelText('Absender')).toHaveValue('Nord-1');
    expect(
      within(dialog).getByText(
        'Unverifiziert · Mesh · Knoten „Nord-1“ (!a1b2c3d4) · nicht signiert',
      ),
    ).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(uebernehmeMeldungVorschlag).toHaveBeenCalledTimes(1));
    const [einsatzId, vid, daten] = uebernehmeMeldungVorschlag.mock.calls[0];
    expect(einsatzId).toBe(7);
    expect(vid).toBe(11);
    expect(daten).toMatchObject({
      inhalt: NORD.text,
      absender: 'Nord-1',
      meldeweg: 'funk',
      meldungsart: 'sonstige',
      ereigniszeit: '2026-11-28 08:41:00',
    });
  });

  it('nimmt ohne Namen die Kennung und ohne Sendezeit den Empfang', async () => {
    renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben />);
    const knoepfe = await screen.findAllByRole('button', { name: 'Als Meldung übernehmen' });
    await userEvent.click(knoepfe[1]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(uebernehmeMeldungVorschlag).toHaveBeenCalledTimes(1));
    expect(uebernehmeMeldungVorschlag.mock.calls[0][1]).toBe(12);
    expect(uebernehmeMeldungVorschlag.mock.calls[0][2]).toMatchObject({
      absender: '!77ee01ff',
      ereigniszeit: '2026-11-28 08:44:10',
    });
  });

  it('zeigt eine Ablehnung im Formular und fragt die Vorschläge neu ab', async () => {
    uebernehmeMeldungVorschlag.mockRejectedValue(
      new ApiError(409, 'Vorschlag ist nicht mehr offen'),
    );
    renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben />);
    const knoepfe = await screen.findAllByRole('button', { name: 'Als Meldung übernehmen' });
    await userEvent.click(knoepfe[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    expect(await within(dialog).findByText(/nicht mehr offen/)).toBeInTheDocument();
    await waitFor(() => expect(listeMeldungVorschlaege).toHaveBeenCalledTimes(2));
  });

  it('sendet je geöffnetem Dialog eine eigene client_id, bei Wiederholung dieselbe', async () => {
    uebernehmeMeldungVorschlag.mockRejectedValueOnce(new ApiError(0, 'Netz weg'));
    renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben />);
    const knoepfe = await screen.findAllByRole('button', { name: 'Als Meldung übernehmen' });
    await userEvent.click(knoepfe[0]);
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(uebernehmeMeldungVorschlag).toHaveBeenCalledTimes(1));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(uebernehmeMeldungVorschlag).toHaveBeenCalledTimes(2));
    const erste = uebernehmeMeldungVorschlag.mock.calls[0][2].client_id;
    expect(erste).toEqual(expect.any(String));
    expect(uebernehmeMeldungVorschlag.mock.calls[1][2].client_id).toBe(erste);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Als Meldung übernehmen' }))[1],
    );
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(uebernehmeMeldungVorschlag).toHaveBeenCalledTimes(3));
    expect(uebernehmeMeldungVorschlag.mock.calls[2][2].client_id).not.toBe(erste);
  });

  it('bietet bei 409 an, die Eingaben als neue Meldung zu erfassen', async () => {
    uebernehmeMeldungVorschlag.mockRejectedValue(
      new ApiError(409, 'Der Vorschlag ist nicht mehr offen'),
    );
    renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben />);
    const knoepfe = await screen.findAllByRole('button', { name: 'Als Meldung übernehmen' });
    await userEvent.click(knoepfe[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    expect(await within(dialog).findByText(/Der Vorschlag ist nicht mehr da/)).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Als neue Meldung erfassen' }),
    );
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledTimes(1));
    const [einsatzId, daten] = legeMeldungAn.mock.calls[0];
    expect(einsatzId).toBe(7);
    expect(daten).toMatchObject({ inhalt: NORD.text, absender: 'Nord-1', meldeweg: 'funk' });
    expect(daten.client_id).not.toBe(uebernehmeMeldungVorschlag.mock.calls[0][2].client_id);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('verwirft einen Vorschlag nach Rückfrage', async () => {
    renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben />);
    const knoepfe = await screen.findAllByRole('button', { name: 'Verwerfen' });
    await userEvent.click(knoepfe[0]);
    expect(verwirfMeldungVorschlag).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Vorschlag verwerfen' }));
    await waitFor(() => expect(verwirfMeldungVorschlag).toHaveBeenCalledWith(7, 11));
  });

  it('zeigt ohne Schreibrecht die Vorschläge ohne Handlungen', async () => {
    renderMitProviders(<MeldungVorschlaege einsatzId={7} darfSchreiben={false} />);
    expect(await screen.findByText(BRUECKE.text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Als Meldung übernehmen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
  });
});
