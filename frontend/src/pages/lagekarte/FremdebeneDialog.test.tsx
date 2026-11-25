import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { FREMDEBENE_FEHLERTEXT, FREMDEBENE_GRENZEN } from '../../api/fremdebenen';
import { einsatzKeys } from '../../api/queryKeys';
import { renderMitProviders } from '../../test/utils';
import FremdebeneDialog, { FREMDEBENE_HINZUFUEGEN, fremdebeneNebenweg } from './FremdebeneDialog';

vi.mock('../../api/fremdebenen', async (original) => ({
  ...(await original<typeof import('../../api/fremdebenen')>()),
  legeFremdebeneAn: vi.fn(),
}));
import { legeFremdebeneAn } from '../../api/fremdebenen';

const lege = vi.mocked(legeFremdebeneAn);

function rendere(onSchliessen = vi.fn()) {
  const r = renderMitProviders(
    <FremdebeneDialog offen einsatzId={7} onSchliessen={onSchliessen} />,
  );
  return { ...r, onSchliessen };
}

const dialog = async () => (await screen.findAllByRole('dialog'))[0];
const dateiInput = (d: HTMLElement) => d.querySelector<HTMLInputElement>('input[type="file"]')!;
const kml = (name = 'Lage Nachbarkreis.kml') =>
  new File(['<kml/>'], name, { type: 'application/vnd.google-earth.kml+xml' });

async function waehleAdresse(d: HTMLElement) {
  await userEvent.click(within(d).getByRole('radio', { name: 'Adresse' }));
}

beforeEach(() => {
  lege.mockReset();
});

describe('FremdebeneDialog', () => {
  it('schaltet das Feld zwischen Datei und Adresse um', async () => {
    rendere();
    const d = await dialog();
    expect(within(d).getByRole('button', { name: /Datei wählen/ })).toBeInTheDocument();
    expect(within(d).queryByRole('textbox', { name: 'Adresse' })).not.toBeInTheDocument();

    await waehleAdresse(d);
    expect(within(d).getByRole('textbox', { name: 'Adresse' })).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: /Datei wählen/ })).not.toBeInTheDocument();

    await userEvent.click(within(d).getByRole('radio', { name: 'Datei' }));
    expect(within(d).getByRole('button', { name: /Datei wählen/ })).toBeInTheDocument();
  });

  it('belegt den Namen aus dem Dateinamen ohne Endung vor und lässt einen getippten stehen', async () => {
    rendere();
    const d = await dialog();
    await userEvent.upload(dateiInput(d), kml());
    const name = within(d).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Lage Nachbarkreis');

    await userEvent.clear(name);
    await userEvent.type(name, 'Eigener Name');
    await userEvent.upload(dateiInput(d), kml('Anderes.kml'));
    expect(name).toHaveValue('Eigener Name');
  });

  it('lehnt eine Datei über 10 MB vor dem Senden ab', async () => {
    rendere();
    const d = await dialog();
    const gross = kml('gross.kml');
    Object.defineProperty(gross, 'size', { value: FREMDEBENE_GRENZEN.dateiBytes + 1 });
    await userEvent.upload(dateiInput(d), gross);
    await userEvent.click(within(d).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(d).findByText(FREMDEBENE_FEHLERTEXT.zu_gross)).toBeInTheDocument();
    expect(lege).not.toHaveBeenCalled();
  });

  it('hält eine Adresse ohne https:// für ungültig', async () => {
    rendere();
    const d = await dialog();
    await waehleAdresse(d);
    await userEvent.type(
      within(d).getByRole('textbox', { name: 'Adresse' }),
      'http://example.org/a.kml',
    );
    await userEvent.click(within(d).getByRole('button', { name: 'Hinzufügen' }));
    expect(
      await within(d).findByText('Die Adresse muss mit https:// beginnen'),
    ).toBeInTheDocument();
    expect(lege).not.toHaveBeenCalled();
  });

  it('hält eine zu lange Adresse für ungültig', async () => {
    rendere();
    const d = await dialog();
    await waehleAdresse(d);
    fireEvent.change(within(d).getByRole('textbox', { name: 'Adresse' }), {
      target: { value: `https://example.org/${'a'.repeat(2048)}` },
    });
    await userEvent.click(within(d).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(d).findByText(/höchstens 2048 Zeichen/)).toBeInTheDocument();
    expect(lege).not.toHaveBeenCalled();
  });

  it('zeigt einen Serverfehler dtd im Dialog, der offen bleibt', async () => {
    lege.mockRejectedValue(new ApiError(422, 'Datei abgelehnt', { grund: 'dtd' }));
    const { onSchliessen } = rendere();
    const d = await dialog();
    await userEvent.upload(dateiInput(d), kml());
    await userEvent.click(within(d).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(d).findByText(FREMDEBENE_FEHLERTEXT.dtd)).toBeInTheDocument();
    expect(onSchliessen).not.toHaveBeenCalled();
    expect(within(d).getByRole('textbox', { name: 'Name' })).toHaveValue('Lage Nachbarkreis');
  });

  it('fällt ohne bekannten Grund auf die Meldung des Servers zurück', async () => {
    lege.mockRejectedValue(new ApiError(500, 'Es ist ein Fehler aufgetreten'));
    rendere();
    const d = await dialog();
    await userEvent.upload(dateiInput(d), kml());
    await userEvent.click(within(d).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(d).findByText('Es ist ein Fehler aufgetreten')).toBeInTheDocument();
  });

  it('legt bei Erfolg an, macht die Liste ungültig und schließt', async () => {
    lege.mockResolvedValue({ id: 3 } as never);
    const { client, onSchliessen } = rendere();
    const ungueltig = vi.spyOn(client, 'invalidateQueries');
    const d = await dialog();
    await userEvent.upload(dateiInput(d), kml());
    await userEvent.click(within(d).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(lege).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ name: 'Lage Nachbarkreis', datei: expect.any(File) }),
      expect.any(Function),
    );
    expect(ungueltig).toHaveBeenCalledWith({ queryKey: einsatzKeys.fremdebenen(7) });
  });

  it('sendet bei einer Adresse die url statt der Datei', async () => {
    lege.mockResolvedValue({ id: 4 } as never);
    rendere();
    const d = await dialog();
    await waehleAdresse(d);
    await userEvent.type(
      within(d).getByRole('textbox', { name: 'Adresse' }),
      'https://example.org/a.kml',
    );
    await userEvent.type(within(d).getByRole('textbox', { name: 'Name' }), 'Nachbar');
    await userEvent.click(within(d).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(lege).toHaveBeenCalled());
    expect(lege.mock.calls[0][1]).toEqual({ name: 'Nachbar', url: 'https://example.org/a.kml' });
  });
});

describe('fremdebeneNebenweg', () => {
  const onWahl = vi.fn();

  it('fehlt ohne Schreibrecht', () => {
    expect(fremdebeneNebenweg({ darfSchreiben: false, ohneVerbindung: false, onWahl })).toBeNull();
  });

  it('ist mit Schreibrecht frei und ruft onWahl', () => {
    const weg = fremdebeneNebenweg({ darfSchreiben: true, ohneVerbindung: false, onWahl })!;
    expect(weg.label).toBe(FREMDEBENE_HINZUFUEGEN);
    expect(weg.gesperrt).toBeUndefined();
    weg.onWahl();
    expect(onWahl).toHaveBeenCalledTimes(1);
  });

  it('ist ohne Netz gesperrt und nennt den Grund im Label', () => {
    const weg = fremdebeneNebenweg({ darfSchreiben: true, ohneVerbindung: true, onWahl })!;
    expect(weg.label).toBe(`${FREMDEBENE_HINZUFUEGEN} (ohne Verbindung)`);
    expect(weg.gesperrt).toBe(true);
  });
});
