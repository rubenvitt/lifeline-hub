import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SchichtplanWechselVorlage } from '../../api/types';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import SchichtplanWechselDialog from './SchichtplanWechselDialog';

const PFAD = '/api/einsaetze/1/abloesungen/schichtplan';

const uhsVorlage: SchichtplanWechselVorlage = {
  block_id: 5,
  art: 'uhs',
  zeitpunkt: '2026-11-14 17:00:00',
  uhs_id: 3,
  uhs: 'Markt',
  kommen: [
    { art: 'stamm', personal_id: 40, einsatz_personal_id: null, name: 'Ben' },
    {
      art: 'einsatz',
      einsatz_personal_id: 22,
      name: 'Finn',
      andere_uhs: 'Bahnhof',
    },
  ],
  gehen: [{ einsatz_personal_id: 21, name: 'Anna' }],
  bleiben: [{ art: 'einsatz', einsatz_personal_id: 23, name: 'Dana' }],
  uebersprungen: [],
  wechsel: [],
};

function render(vorlage: SchichtplanWechselVorlage) {
  server.use(http.get(`${PFAD}/bloecke/5/wechsel`, () => HttpResponse.json(vorlage)));
  const onSchliessen = vi.fn();
  renderMitProviders(
    <SchichtplanWechselDialog einsatzId={1} blockId={5} onSchliessen={onSchliessen} />,
  );
  return { onSchliessen };
}

describe('SchichtplanWechselDialog', () => {
  it('belegt den Wechsel an der UHS vor und schickt die Auswahl', async () => {
    let rumpf: unknown = null;
    server.use(
      http.post(`${PFAD}/bloecke/5/wechsel`, async ({ request }) => {
        rumpf = await request.json();
        return HttpResponse.json({ id: 9 }, { status: 201 });
      }),
    );
    const { onSchliessen } = render(uhsVorlage);
    const dialog = await screen.findByRole('dialog');
    const ben = await within(dialog).findByRole('checkbox', { name: 'Ben · neu im Einsatz' });
    expect(ben).toBeChecked();
    const finn = within(dialog).getByRole('checkbox', { name: 'Finn · von Bahnhof' });
    expect(within(dialog).getByRole('checkbox', { name: 'Anna' })).toBeChecked();
    expect(within(dialog).getByText('Dana')).toBeInTheDocument();
    await userEvent.click(finn);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wechsel vollziehen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(rumpf).toEqual({
      art: 'uhs',
      kommen: [{ art: 'stamm', personal_id: 40 }],
      gehen: [21],
    });
  });

  it('sperrt die Pause ohne gekennzeichneten Status mit Grund', async () => {
    render({
      ...uhsVorlage,
      art: 'pause_beginn',
      uhs: null,
      uhs_id: null,
      kommen: [{ art: 'einsatz', einsatz_personal_id: 21, name: 'Anna' }],
      gehen: [],
      bleiben: [],
      uebersprungen: [{ art: 'stamm', personal_id: 41, einsatz_personal_id: null, name: 'Cora' }],
      gesperrt: 'Kein Personalstatus ist als Pause gekennzeichnet',
    });
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('Kein Personalstatus ist als Pause gekennzeichnet'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Cora')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Pause beginnen' })).toBeDisabled();
  });

  it('nimmt einen vollzogenen Wechsel zurück', async () => {
    let zurueck = false;
    server.use(
      http.post(`${PFAD}/wechsel/9/zuruecknehmen`, () => {
        zurueck = true;
        return HttpResponse.json({ id: 9 });
      }),
    );
    render({
      ...uhsVorlage,
      art: null,
      wechsel: [
        {
          id: 9,
          art: 'uhs',
          planschicht_id: 5,
          uhs_id: 3,
          zeitpunkt: '2026-11-14 17:00:00',
          vollzogen_at: '2026-11-14 17:02:00',
        },
      ],
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Vollzogen' })).toBeDisabled();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Zurücknehmen' }));
    // Die Rückfrage bringt einen zweiten Knopf gleichen Namens (im Portal, also dahinter).
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Zurücknehmen' })).toHaveLength(2),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Zurücknehmen' })[1]);
    await waitFor(() => expect(zurueck).toBe(true));
  });
});
