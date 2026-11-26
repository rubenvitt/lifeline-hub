import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { herkunftHandler } from '../test/stammdatenHerkunft';
import type { ExterneStelle } from '../api/types';
import ExterneStelleFormModal from './ExterneStelleFormModal';

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
      await screen.findByRole('button', { name: 'Adresse leitstelle@example.org entfernen' }),
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
});
