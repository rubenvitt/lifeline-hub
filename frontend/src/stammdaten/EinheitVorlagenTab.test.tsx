import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { EINHEIT_TYPEN, VORLAGEN, einheitVorlageFixture } from '../test/einheitVorlagen';
import { EINHEIT_VORLAGE_NAME_MAX } from '../api/eingabegrenzen';
import type { EinheitVorlage } from '../api/types';
import EinheitVorlagenTab from './EinheitVorlagenTab';

/** LLH-1042: Sektion „Einheiten-Vorlagen“ der Stammdaten. */

const admin = adminFixture();

const firstColumn = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

function render(list: EinheitVorlage[] = VORLAGEN) {
  let query = '';
  server.use(
    meHandler(admin),
    http.get('/api/einheit-vorlagen', ({ request }) => {
      query = new URL(request.url).search;
      return HttpResponse.json(list);
    }),
    http.get('/api/einheit-typen', () => HttpResponse.json(EINHEIT_TYPEN)),
  );
  const result = renderMitProviders(
    <Routes>
      <Route path="/admin/stammdaten/einheiten" element={<EinheitVorlagenTab />} />
      <Route path="/admin/stammdaten/einheiten/:vorlageId" element={<p>Detailseite</p>} />
    </Routes>,
    { route: '/admin/stammdaten/einheiten' },
  );
  return { ...result, query: () => query };
}

describe('EinheitVorlagenTab', () => {
  it('lädt auch die inaktiven und stellt Untereinheiten eingerückt unter ihre Vorlage', async () => {
    const { container, query } = render();
    await screen.findByText('Rettungsstaffel');
    expect(query()).toBe('?nur_aktive=false');
    expect(firstColumn(container)).toEqual([
      'Löschzug Nord',
      'Sanitätszug MusterstadtDemo',
      'RettungsstaffelDemo',
      'SEG Behandlung',
    ]);
    const staffel = screen.getByRole('link', { name: 'Rettungsstaffel' });
    const zug = screen.getByRole('link', { name: 'Sanitätszug Musterstadt' });
    expect(staffel).toHaveAttribute('href', '/admin/stammdaten/einheiten/11');
    // Eingerückt: die Untereinheit steht eine Stufe tiefer als ihre Vorlage.
    expect(staffel.closest('[data-tiefe]')).toHaveAttribute('data-tiefe', '1');
    expect(zug.closest('[data-tiefe]')).toHaveAttribute('data-tiefe', '0');
  });

  it('zeigt Typ, Unterstellung, Fahrzeuge, Soll und den Zustand als Wort', async () => {
    render();
    const zeile = (await screen.findByRole('link', { name: 'Rettungsstaffel' })).closest('tr')!;
    expect(within(zeile).getByText('Staffel')).toBeInTheDocument();
    expect(within(zeile).getByText('Sanitätszug Musterstadt')).toBeInTheDocument();
    expect(within(zeile).getByText('Rotkreuz Musterstadt 83-1')).toBeInTheDocument();
    // Eigenes Soll steht nackt, das des Typs trägt „(Vorgabe)“.
    expect(within(zeile).getByText('0/1/3//4')).toBeInTheDocument();
    const zug = screen.getByRole('link', { name: 'Sanitätszug Musterstadt' }).closest('tr')!;
    expect(within(zug).getByText('1/2/19//22 (Vorgabe)')).toBeInTheDocument();
    const seg = screen.getByRole('link', { name: 'SEG Behandlung' }).closest('tr')!;
    expect(within(seg).getByText('Inaktiv')).toBeInTheDocument();
  });

  it('legt eine Vorlage mit Name, Typ und Unterstellung an und öffnet ihre Detailseite', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/einheit-vorlagen', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(einheitVorlageFixture({ id: 21, name: 'Betreuungsgruppe' }), {
          status: 201,
        });
      }),
    );
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Vorlage anlegen' }));
    const dialog = await screen.findByRole('dialog');
    // Drei Felder (Feldbudget eines Modals), der Name mit der Grenze des Servers.
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute(
      'maxlength',
      String(EINHEIT_VORLAGE_NAME_MAX),
    );
    await user.type(within(dialog).getByLabelText('Name'), '  Betreuungsgruppe ');
    await user.click(within(dialog).getByLabelText('Typ'));
    await user.click(await screen.findByTitle('Staffel'));
    await user.click(within(dialog).getByLabelText('Unter'));
    // Nur aktive Vorlagen kommen als Unterstellung in Frage.
    expect(screen.queryByTitle('SEG Behandlung')).toBeNull();
    await user.click(await screen.findByTitle('Sanitätszug Musterstadt'));
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByText('Detailseite')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Betreuungsgruppe', typ_id: 2, ueber_vorlage_id: 10 });
  });

  it('ohne Unterstellung geht keine Unterstellung auf den Draht', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/einheit-vorlagen', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(einheitVorlageFixture({ id: 22 }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Vorlage anlegen' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Zug Süd');
    await user.click(within(dialog).getByLabelText('Typ'));
    await user.click(await screen.findByTitle('Zug'));
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(body).toEqual({ name: 'Zug Süd', typ_id: 1 }));
  });

  it('eine Ablehnung steht im Dialog, die Felder bleiben', async () => {
    server.use(
      http.post('/api/einheit-vorlagen', () =>
        HttpResponse.json(
          { error: 'Eine aktive Einheiten-Vorlage mit diesem Namen gibt es schon' },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Vorlage anlegen' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Löschzug Nord');
    await user.click(within(dialog).getByLabelText('Typ'));
    await user.click(await screen.findByTitle('Zug'));
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText(/mit diesem Namen gibt es schon/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Löschzug Nord');
  });
});
