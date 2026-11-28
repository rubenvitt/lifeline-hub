import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
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
  art: 'email' | 'fax' | 'matrix' | 'threema' = 'email',
  stelleId = id,
): KanalMitStelle => ({
  agency_id: stelleId,
  agency_name: stelle,
  channel: { id, externe_stelle_id: stelleId, channel: art, address: adresse },
});

const KANAELE = [kanal(11, 'ILS Nord', 'ils@example.org'), kanal(12, 'THW OV', 'thw@example.org')];

function kanaele(liste: KanalMitStelle[]) {
  server.use(http.get('/api/external-agencies/channels', () => HttpResponse.json(liste)));
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
  it('ordnet die Adressen je Stelle, Stellen nach Namen, in der Stelle Mail, Matrix, Fax', async () => {
    kanaele([
      kanal(31, 'THW OV', 'thw@example.org', 'email', 3),
      kanal(21, 'ILS Nord', '+49511123456', 'fax', 2),
      kanal(32, 'Kreis', 'kreis@example.org', 'email', 4),
      kanal(22, 'ILS Nord', 'ils@example.org', 'email', 2),
      kanal(23, 'ILS Nord', '#lageraum:example.org', 'matrix', 2),
    ]);
    zeige({ vorschlagNamen: [] });
    await screen.findByRole('checkbox', { name: /thw@/ });
    const stellen = [...document.querySelectorAll('[data-lfh="senden-stelle"]')].map((g) =>
      g.getAttribute('aria-label'),
    );
    expect(stellen).toEqual(['ILS Nord', 'Kreis', 'THW OV']);
    const ils = within(screen.getByRole('group', { name: 'ILS Nord' }));
    expect(ils.getAllByRole('checkbox').map((c) => c.getAttribute('value'))).toEqual([
      '22',
      '23',
      '21',
    ]);
  });

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
        HttpResponse.json({ error: 'Anbindung fehlt', grund: 'anbindung_fehlt' }, { status: 422 }),
      ),
    );
    zeige();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /ILS Nord/ })).toBeChecked());
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Kein Mailserver eingerichtet')).toBeInTheDocument();
  });

  it('sperrt ohne Adresse mit sichtbarem Grund', async () => {
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

  it('sammlung_zeigt_kanal_zeichen_je_adresse', async () => {
    let abgerufen = '';
    server.use(
      http.get('/api/external-agencies/channels', ({ request }) => {
        abgerufen = new URL(request.url).search;
        return HttpResponse.json([
          kanal(21, 'ILS Nord', 'ils@example.org', 'email', 2),
          kanal(22, 'ILS Nord', '#lageraum:example.org', 'matrix', 2),
        ]);
      }),
    );
    zeige({ vorschlagNamen: [] });
    const mail = await screen.findByRole('checkbox', { name: /ils@example\.org/ });
    const matrix = screen.getByRole('checkbox', { name: /#lageraum:example\.org/ });
    // Kanal als kleines Wort vor der Adresse, Sammlung ohne Filter.
    expect(mail.closest('label')).toHaveTextContent(/^Mail\s*ils@example\.org/);
    expect(matrix.closest('label')).toHaveTextContent(/^Matrix\s*#lageraum/);
    // Beide Adressen stehen beisammen unter dem Namen ihrer Stelle, Mail vor Matrix.
    const stelle = screen.getByRole('group', { name: 'ILS Nord' });
    expect(within(stelle).getAllByRole('checkbox')).toEqual([mail, matrix]);
    expect(abgerufen).toBe('');
  });

  it('sperrt_nur_matrix_adressen_wenn_kein_matrix_konto', async () => {
    kanaele([
      kanal(21, 'ILS Nord', 'ils@example.org'),
      kanal(22, 'ILS Nord', '#lageraum:example.org', 'matrix', 21),
    ]);
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', () =>
        HttpResponse.json(
          { error: 'Kein Matrix-Konto eingerichtet', grund: 'anbindung_fehlt' },
          { status: 422 },
        ),
      ),
    );
    zeige();
    const matrix = await screen.findByRole('checkbox', { name: /#lageraum:example\.org/ });
    // Vorbelegt: je Stelle eine Adresse, Matrix vor Mail.
    await waitFor(() => expect(matrix).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /ils@example\.org/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect((await screen.findAllByText(/Kein Matrix-Konto eingerichtet/)).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText('Kein Mailserver eingerichtet')).toBeNull();
    // Nur die Matrix-Adresse ist gesperrt und abgewählt; die Mailadresse bleibt wählbar.
    await waitFor(() => expect(matrix).toBeDisabled());
    expect(matrix).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /ils@example\.org/ })).toBeEnabled();
  });
  it('sperrt_bei_reinem_matrix_versand_die_matrix_adressen_mit_beliebigem_servertext', async () => {
    kanaele([
      kanal(21, 'ILS Nord', 'ils@example.org'),
      kanal(22, 'ILS Nord', '#lageraum:example.org', 'matrix', 21),
    ]);
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', () =>
        HttpResponse.json({ error: 'Anbindung fehlt', grund: 'anbindung_fehlt' }, { status: 422 }),
      ),
    );
    zeige();
    const matrix = await screen.findByRole('checkbox', { name: /#lageraum:example\.org/ });
    await waitFor(() => expect(matrix).toBeChecked());
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect((await screen.findAllByText(/Kein Matrix-Konto eingerichtet/)).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText('Kein Mailserver eingerichtet')).toBeNull();
    await waitFor(() => expect(matrix).toBeDisabled());
  });

  it('zieht_im_gemischten_fall_den_servertext_heran_und_sperrt_matrix_nicht', async () => {
    kanaele([
      kanal(21, 'ILS Nord', 'ils@example.org'),
      kanal(22, 'ILS Nord', '#lageraum:example.org', 'matrix', 21),
    ]);
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', () =>
        HttpResponse.json(
          { error: 'Kein Mailserver eingerichtet', grund: 'anbindung_fehlt' },
          { status: 422 },
        ),
      ),
    );
    zeige();
    const matrix = await screen.findByRole('checkbox', { name: /#lageraum:example\.org/ });
    await waitFor(() => expect(matrix).toBeChecked());
    await userEvent.click(screen.getByRole('checkbox', { name: /ils@example\.org/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect((await screen.findAllByText('Kein Mailserver eingerichtet')).length).toBeGreaterThan(0);
    expect(matrix).toBeEnabled();
  });

  it('waehlt_nach_der_matrix_sperre_die_mailadresse_derselben_stelle_nach', async () => {
    kanaele([
      kanal(21, 'ILS Nord', 'ils@example.org'),
      kanal(22, 'ILS Nord', '#lageraum:example.org', 'matrix', 21),
      kanal(31, 'ILS Nord', 'zweite@example.org', 'email', 21),
    ]);
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', () =>
        HttpResponse.json({ error: 'Anbindung fehlt', grund: 'anbindung_fehlt' }, { status: 422 }),
      ),
    );
    zeige();
    const matrix = await screen.findByRole('checkbox', { name: /#lageraum:example\.org/ });
    await waitFor(() => expect(matrix).toBeChecked());
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(matrix).toBeDisabled());
    // Die erste Mailadresse derselben Stelle ersetzt die abgewählte Matrix-Adresse.
    expect(screen.getByRole('checkbox', { name: /ils@example\.org/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /zweite@example\.org/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled();
  });

  it('zeigt Faxnummern mit Kanalzeichen und sendet an eine Faxnummer', async () => {
    kanaele([...KANAELE, kanal(21, 'Kreis', '+49511123456', 'fax')]);
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json([], { status: 201 });
      }),
    );
    zeige({ vorschlagNamen: [] });
    const fax = await screen.findByRole('checkbox', { name: /Kreis · \+49511123456/ });
    expect(fax.closest('label')).toHaveTextContent(/^Fax\s*\+49511123456/);
    await userEvent.click(fax);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as { recipients: unknown }).recipients).toEqual([{ channel_id: 21 }]);
  });

  it('belegt nur Mailadressen vor, nie zusätzlich die Faxnummer derselben Stelle', async () => {
    kanaele([...KANAELE, kanal(21, 'ILS Nord', '+49511123456', 'fax', 11)]);
    zeige();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /ILS Nord · ils@/ })).toBeChecked(),
    );
    expect(screen.getByRole('checkbox', { name: /ILS Nord · \+49/ })).not.toBeChecked();
  });

  it('nennt den fehlenden Faxzugang, wenn nur Faxe gehen', async () => {
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
    expect(screen.queryByText('Kein Mailserver eingerichtet')).toBeNull();
  });

  it('zeigt bei zu_gross den Text des Servers, der den Kanal nennt', async () => {
    kanaele([kanal(21, 'Kreis', '+49511123456', 'fax')]);
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', () =>
        HttpResponse.json(
          {
            error: 'Das Fax hätte 45 Seiten; erlaubt sind höchstens 30 Seiten und 10 MiB',
            grund: 'zu_gross',
          },
          { status: 422 },
        ),
      ),
    );
    zeige({ vorschlagNamen: [] });
    await userEvent.click(await screen.findByRole('checkbox', { name: /Kreis/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText(/Das Fax hätte 45 Seiten/)).toBeInTheDocument();
    expect(screen.queryByText('Anhänge zu groß für eine Mail')).toBeNull();
  });

  it('threema_wird_angeboten', async () => {
    kanaele([kanal(21, 'ILS Nord', 'ils@example.org'), kanal(22, 'ILS Nord', 'ECHOECHO', 'threema', 21)]);
    zeige();
    const threema = await screen.findByRole('checkbox', { name: /ECHOECHO/ });
    expect(threema.closest('label')).toHaveTextContent(/^Threema\s*ECHOECHO/);
    // Vorbelegt: Threema vor Mail.
    await waitFor(() => expect(threema).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /ils@example\.org/ })).not.toBeChecked();
  });

  it('matrix_und_threema_gesperrt_mail_rueckt_nach', async () => {
    kanaele([
      kanal(21, 'ILS Nord', 'ils@example.org'),
      kanal(22, 'ILS Nord', '#lageraum:example.org', 'matrix', 21),
      kanal(31, 'Kreis', 'kreis@example.org', 'email', 31),
      kanal(32, 'Kreis', 'ECHOECHO', 'threema', 31),
    ]);
    server.use(
      http.post('/api/incidents/1/situation-reports/5/deliveries', () =>
        HttpResponse.json(
          {
            error: 'Kein Matrix-Konto eingerichtet; Kein Threema-Gateway eingerichtet',
            grund: 'anbindung_fehlt',
          },
          { status: 422 },
        ),
      ),
    );
    zeige({ vorschlagNamen: ['ILS Nord', 'Kreis'] });
    const matrix = await screen.findByRole('checkbox', { name: /#lageraum:example\.org/ });
    const threema = screen.getByRole('checkbox', { name: /ECHOECHO/ });
    await waitFor(() => expect(matrix).toBeChecked());
    expect(threema).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(matrix).toBeDisabled());
    expect(threema).toBeDisabled();
    expect(matrix).not.toBeChecked();
    expect(threema).not.toBeChecked();
    // Je Stelle rückt die Mail nach.
    expect(screen.getByRole('checkbox', { name: /ils@example\.org/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /kreis@example\.org/ })).toBeChecked();
    expect(screen.getAllByText(/Kein Threema-Gateway eingerichtet/).length).toBeGreaterThan(0);
  });
});
