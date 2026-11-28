import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { herkunftHandler } from '../test/stammdatenHerkunft';
import type { ExterneStelle } from '../api/types';
import ExterneStelleFormModal from './ExterneStelleFormModal';
import { istFaxnummerGueltig } from './ExterneStelleKanaele';

/** LLH-2093: Mailadressen einer externen Stelle im Formular („Erreichbar per“). */

const ils: ExterneStelle = {
  id: 4,
  bezeichnung: 'ILS Musterkreis',
  art: 'leitstelle',
  aktiv: true,
  zustaendig: false,
};

const bestehend = {
  id: 11,
  externe_stelle_id: 4,
  channel: 'email',
  address: 'leitstelle@example.org',
};

function kanaeleHandler(liste: unknown[]) {
  return http.get('/api/external-agencies/4/channels', () => HttpResponse.json(liste));
}

describe('ExterneStelle Kanaladressen', () => {
  it('zeigt hinterlegte Mailadressen und fügt eine hinzu', async () => {
    const liste: unknown[] = [bestehend];
    let body: unknown = null;
    server.use(
      kanaeleHandler(liste),
      http.post('/api/external-agencies/4/channels', async ({ request }) => {
        body = await request.json();
        const neu = { id: 12, externe_stelle_id: 4, ...(body as object) };
        liste.push(neu);
        return HttpResponse.json(neu, { status: 201 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);

    expect(await screen.findByText('leitstelle@example.org')).toBeInTheDocument();
    expect(screen.getByText('Erreichbar per')).toBeInTheDocument();

    await nutzer.type(screen.getByLabelText('Mailadresse'), 'einsatz@example.org');
    await nutzer.type(screen.getByLabelText('Beschriftung'), 'Einsatzpostfach');
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));

    await waitFor(() =>
      expect(body).toEqual({
        channel: 'email',
        address: 'einsatz@example.org',
        label: 'Einsatzpostfach',
      }),
    );
    expect(await screen.findByText('einsatz@example.org')).toBeInTheDocument();
    expect(screen.getByText('leitstelle@example.org')).toBeInTheDocument();
  });

  it('bietet_bei_neuer_adresse_email_und_matrix_raum_an', async () => {
    const liste: unknown[] = [];
    const bodies: unknown[] = [];
    server.use(
      kanaeleHandler(liste),
      http.post('/api/external-agencies/4/channels', async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        const neu = { id: 20 + bodies.length, externe_stelle_id: 4, ...(body as object) };
        liste.push(neu);
        return HttpResponse.json(neu, { status: 201 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);

    await nutzer.click(await screen.findByRole('radio', { name: 'Matrix' }));
    // Eine Mailadresse ist als Matrix-Raum ungültig, ohne Request.
    await nutzer.type(screen.getByLabelText('Matrix-Raum'), 'ils@example.org');
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));
    expect(await screen.findByText('Matrix-Raum ungültig')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);

    await nutzer.clear(screen.getByLabelText('Matrix-Raum'));
    await nutzer.type(screen.getByLabelText('Matrix-Raum'), '#lageraum:example.org');
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ channel: 'matrix', address: '#lageraum:example.org' }]),
    );
    // Die Liste nennt den Kanal vor der Adresse.
    const eintrag = (await screen.findByText('#lageraum:example.org')).closest('li');
    expect(eintrag).toHaveTextContent('Matrix');
  });

  it('threema_id_hinzufuegen', async () => {
    const liste: unknown[] = [];
    const bodies: unknown[] = [];
    server.use(
      kanaeleHandler(liste),
      http.post('/api/external-agencies/4/channels', async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        const neu = { id: 30, externe_stelle_id: 4, ...(body as object), address: 'ECHOECHO' };
        liste.push(neu);
        return HttpResponse.json(neu, { status: 201 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);

    await nutzer.click(await screen.findByRole('radio', { name: 'Threema' }));
    // Sieben Zeichen sind keine Threema-ID, ohne Request.
    await nutzer.type(screen.getByLabelText('Threema-ID'), 'ECHOECH');
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));
    expect(
      await screen.findByText('Eine Threema-ID hat acht Zeichen (Buchstaben und Ziffern)'),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(0);

    await nutzer.clear(screen.getByLabelText('Threema-ID'));
    await nutzer.type(screen.getByLabelText('Threema-ID'), 'echo echo');
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));
    await waitFor(() => expect(bodies).toEqual([{ channel: 'threema', address: 'echo echo' }]));
    const eintrag = (await screen.findByText('ECHOECHO')).closest('li');
    expect(eintrag).toHaveTextContent('Threema');
    expect(
      screen.getByRole('button', { name: 'Threema-ID ECHOECHO entfernen' }),
    ).toBeInTheDocument();
  });

  it('lehnt einen matrix.to-Link mit eigenem Text ohne Request ab', async () => {
    let gepostet = false;
    server.use(
      kanaeleHandler([]),
      http.post('/api/external-agencies/4/channels', () => {
        gepostet = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);

    await nutzer.click(await screen.findByRole('radio', { name: 'Matrix' }));
    await nutzer.type(
      screen.getByLabelText('Matrix-Raum'),
      'https://matrix.to/#/#lageraum:example.org',
    );
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));

    expect(
      await screen.findByText('matrix.to-Links gehen nicht, bitte Raum-ID oder Alias eintragen'),
    ).toBeInTheDocument();
    expect(gepostet).toBe(false);
  });

  it('meldet „Mailadresse ungültig“ ohne Request', async () => {
    let gepostet = false;
    server.use(
      kanaeleHandler([]),
      http.post('/api/external-agencies/4/channels', () => {
        gepostet = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);

    await nutzer.type(await screen.findByLabelText('Mailadresse'), 'kein at zeichen');
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));

    expect(await screen.findByText('Mailadresse ungültig')).toBeInTheDocument();
    expect(gepostet).toBe(false);
  });

  it('entfernt eine Adresse', async () => {
    let geloescht = '';
    server.use(
      kanaeleHandler([bestehend]),
      http.delete('/api/external-agencies/4/channels/11', ({ request }) => {
        geloescht = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);

    await nutzer.click(
      await screen.findByRole('button', { name: 'Mailadresse leitstelle@example.org entfernen' }),
    );
    await waitFor(() => expect(geloescht).toBe('/api/external-agencies/4/channels/11'));
  });

  it('zeigt eine neue Stelle ohne Abschnitt „Erreichbar per“', async () => {
    renderMitProviders(<ExterneStelleFormModal offen stelle={null} onClose={() => {}} />);
    await screen.findByLabelText('Bezeichnung');
    expect(screen.queryByText('Erreichbar per')).toBeNull();
  });

  it('hält eine Stelle vom Hub schreibgeschützt und nennt den Grund', async () => {
    server.use(herkunftHandler({ externe_stelle: ['4'] }), kanaeleHandler([bestehend]));
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);

    expect(await screen.findByText('leitstelle@example.org')).toBeInTheDocument();
    expect(await screen.findByText(/kommt vom Hub/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adresse hinzufügen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /entfernen/ })).toBeNull();
  });

  it('fügt eine Faxnummer hinzu und prüft sie vorher', async () => {
    let body: unknown = null;
    server.use(
      kanaeleHandler([]),
      http.post('/api/external-agencies/4/channels', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 13, externe_stelle_id: 4, channel: 'fax', address: '+49511123456' },
          { status: 201 },
        );
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);

    await nutzer.click(await screen.findByRole('radio', { name: 'Fax' }));
    const feld = screen.getByLabelText('Faxnummer');
    expect(feld).toHaveAttribute('inputmode', 'tel');
    await nutzer.type(feld, 'Leitstelle anrufen');
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));
    expect(await screen.findByText('Keine gültige Faxnummer')).toBeInTheDocument();
    expect(body).toBeNull();

    await nutzer.clear(feld);
    await nutzer.type(feld, '0511 123456');
    await nutzer.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));
    await waitFor(() => expect(body).toEqual({ channel: 'fax', address: '0511 123456' }));
  });

  it('zeigt Faxnummern mit ihrem Kanal', async () => {
    server.use(
      kanaeleHandler([
        bestehend,
        { id: 12, externe_stelle_id: 4, channel: 'fax', address: '+49511123456' },
      ]),
    );
    renderMitProviders(<ExterneStelleFormModal offen stelle={ils} onClose={() => {}} />);
    expect(await screen.findByText('+49511123456')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Faxnummer +49511123456 entfernen' }),
    ).toBeInTheDocument();
  });
});

describe('istFaxnummerGueltig (LLH-2095)', () => {
  it('nimmt Alltagsformen an und lehnt Text ab', () => {
    for (const gut of ['0511 123456', '+49 (0) 511 / 123 45-6', '0049 511 123456', '+43 1 58801']) {
      expect(istFaxnummerGueltig(gut)).toBe(true);
    }
    for (const schlecht of ['', '511 123', '+49 12', '0511 abc', '+0511123456']) {
      expect(istFaxnummerGueltig(schlecht)).toBe(false);
    }
  });
});
