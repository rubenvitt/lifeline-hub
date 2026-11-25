import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import type { KanalMitStelle } from '../api/types';
import SendenDialog from './SendenDialog';

const kanal = (
  id: number,
  stelle: string,
  adresse: string,
  art: 'email' | 'fax' = 'email',
): KanalMitStelle => ({
  agency_id: id,
  agency_name: stelle,
  channel: { id, externe_stelle_id: id, channel: art, address: adresse },
});

const KANAELE = [kanal(11, 'ILS Nord', 'ils@example.org'), kanal(12, 'THW OV', 'thw@example.org')];

function kanaele(liste: KanalMitStelle[]) {
  server.use(
    http.get('/api/external-agencies/channels', ({ request }) => {
      const art = new URL(request.url).searchParams.get('channel');
      return HttpResponse.json(liste.filter((k) => k.channel.channel === art));
    }),
  );
}

function zeige(over: Partial<React.ComponentProps<typeof SendenDialog>> = {}) {
  return renderMitProviders(
    <SendenDialog
      offen
      onClose={() => undefined}
      einsatzId={1}
      quelle={{ kind: 'lagebericht', id: 5 }}
      vorschlagNamen={['ils  nord']}
      vorschauText={'Zeile 1\nZeile 2\nZeile 3\nZeile 4'}
      {...over}
    />,
  );
}

afterEach(() => setzeOnline(true));

describe('SendenDialog (LLH-2093)', () => {
  it('belegt die Stellen des Verteilers vor und schickt die Auswahl einmal', async () => {
    kanaele(KANAELE);
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json([], { status: 201 });
      }),
    );
    zeige();
    const ils = await screen.findByRole('checkbox', { name: /ILS Nord/ });
    await waitFor(() => expect(ils).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /THW OV/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const body = bodies[0] as { client_id: string; recipients: unknown };
    expect(body.recipients).toEqual([{ channel_id: 11 }]);
    expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('zeigt „Kein Mailserver eingerichtet“ bei 422 anbindung_fehlt', async () => {
    kanaele(KANAELE);
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', () =>
        HttpResponse.json(
          { error: 'Kein Mailserver eingerichtet', grund: 'anbindung_fehlt' },
          { status: 422 },
        ),
      ),
    );
    zeige();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /ILS Nord/ })).toBeChecked());
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Kein Mailserver eingerichtet')).toBeInTheDocument();
  });

  it('sperrt ohne Mailadresse mit sichtbarem Grund', async () => {
    kanaele([]);
    zeige();
    expect(await screen.findByText('Keine Adresse hinterlegt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
  });

  it('sperrt ohne Netz mit sichtbarem Grund', async () => {
    kanaele(KANAELE);
    zeige();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /ILS Nord/ })).toBeChecked());
    setzeOnline(false);
    expect(await screen.findByText('Ohne Netz nicht möglich')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
  });

  it('zeigt nur den Beginn des Textes und die Anhänge', async () => {
    kanaele(KANAELE);
    zeige({ anhaenge: { anzahl: 2, bytes: 3 * 1024 * 1024 } });
    expect(await screen.findByText(/Zeile 3/)).toBeInTheDocument();
    expect(screen.queryByText(/Zeile 4/)).toBeNull();
    expect(screen.getByText(/2 Anhänge/)).toBeInTheDocument();
  });

  it('sperrt Senden ohne gewählte Adresse', async () => {
    kanaele(KANAELE);
    zeige({ vorschlagNamen: [] });
    await screen.findByRole('checkbox', { name: /ILS Nord/ });
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
  });

  it('zeigt Mail und Fax getrennt und sendet an eine Faxnummer', async () => {
    kanaele([...KANAELE, kanal(21, 'Kreis', '+49511123456', 'fax')]);
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json([], { status: 201 });
      }),
    );
    zeige({ vorschlagNamen: [] });
    expect(await screen.findByText('E-Mail')).toBeInTheDocument();
    expect(screen.getByText('Fax')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Kreis · \+49511123456/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as { recipients: unknown }).recipients).toEqual([{ channel_id: 21 }]);
  });

  it('belegt nur Mailadressen vor, nie zusätzlich die Faxnummer derselben Stelle', async () => {
    kanaele([...KANAELE, kanal(21, 'ILS Nord', '+49511123456', 'fax')]);
    zeige();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /ILS Nord · ils@/ })).toBeChecked(),
    );
    expect(screen.getByRole('checkbox', { name: /ILS Nord · \+49/ })).not.toBeChecked();
  });

  it('zeigt den Text des Servers, wenn der Faxzugang fehlt', async () => {
    kanaele([kanal(21, 'Kreis', '+49511123456', 'fax')]);
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', () =>
        HttpResponse.json(
          { error: 'Kein Faxzugang eingerichtet', grund: 'anbindung_fehlt' },
          { status: 422 },
        ),
      ),
    );
    zeige({ vorschlagNamen: [] });
    await userEvent.click(await screen.findByRole('checkbox', { name: /Kreis/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Kein Faxzugang eingerichtet')).toBeInTheDocument();
  });
});
