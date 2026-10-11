import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import type { ExterneStelle } from '../api/types';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import ExterneStellenTab from './ExterneStellenTab';

/** LFH-1194, design.md D10: Verwaltung des Katalogs „Externe Stellen“. */

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

/** In der Reihenfolge des Backends (Art, zuständige vorn, Name). */
const KATALOG: ExterneStelle[] = [
  { id: 1, bezeichnung: 'ILS Musterkreis', art: 'leitstelle', aktiv: true, zustaendig: true },
  { id: 2, bezeichnung: 'Polizei Musterstadt', art: 'polizei', aktiv: true, zustaendig: false },
  {
    id: 3,
    bezeichnung: 'Ordnungsamt',
    art: 'behoerde',
    rufnummer: '0800 123',
    aktiv: false,
    zustaendig: false,
  },
];

const bezeichnungen = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

function render(benutzer: typeof admin, liste: ExterneStelle[] = KATALOG) {
  let abgerufen = '';
  server.use(
    meHandler(benutzer),
    http.get('/api/externe-stellen', ({ request }) => {
      abgerufen = new URL(request.url).search;
      return HttpResponse.json(liste);
    }),
  );
  return { ...renderMitProviders(<ExterneStellenTab />), abgerufen: () => abgerufen };
}

describe('ExterneStellenTab', () => {
  it('lädt auch die inaktiven und zeigt Art, Rufnummer und die Marke „zuständig“ als Wort', async () => {
    const { container, abgerufen } = render(admin);
    await screen.findByText('Polizei Musterstadt');
    expect(abgerufen()).toBe('?nur_aktive=false');
    expect(bezeichnungen(container)).toEqual([
      'ILS Musterkreis zuständig',
      'Polizei Musterstadt',
      'Ordnungsamt',
    ]);
    expect(screen.getByText('Behörde')).toBeInTheDocument();
    expect(screen.getByText('0800 123')).toBeInTheDocument();
    expect(screen.getByText('Inaktiv')).toBeInTheDocument();
  });

  it('filtert nach Art', async () => {
    const { container } = render(admin);
    await screen.findByText('Polizei Musterstadt');
    const kopf = screen.getByRole('columnheader', { name: /^Art/ });
    await userEvent.click(kopf.querySelector('.ant-table-filter-trigger') as HTMLElement);
    const korb = document.querySelector('.ant-table-filter-dropdown') as HTMLElement;
    await userEvent.click(within(korb).getByText('Polizei'));
    await userEvent.click(within(korb).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(bezeichnungen(container)).toEqual(['Polizei Musterstadt']));
  });

  it('filtert nach aktiv/inaktiv', async () => {
    const { container } = render(admin);
    await screen.findByText('Polizei Musterstadt');
    const kopf = screen.getByRole('columnheader', { name: /^Aktiv/ });
    await userEvent.click(kopf.querySelector('.ant-table-filter-trigger') as HTMLElement);
    const korb = document.querySelector('.ant-table-filter-dropdown') as HTMLElement;
    await userEvent.click(within(korb).getByText('Inaktiv'));
    await userEvent.click(within(korb).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(bezeichnungen(container)).toEqual(['Ordnungsamt']));
  });

  it('deaktiviert nach Rückfrage und aktiviert wieder', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch('/api/externe-stellen/:id', async ({ request, params }) => {
        bodies.push({ id: Number(params.id), ...((await request.json()) as object) });
        return HttpResponse.json(KATALOG[0]);
      }),
    );
    render(admin);
    await screen.findByText('Polizei Musterstadt');

    const zeile = screen.getByText('Polizei Musterstadt').closest('tr') as HTMLElement;
    await userEvent.click(within(zeile).getByRole('button', { name: 'Deaktivieren' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stelle deaktivieren' }));
    await waitFor(() => expect(bodies).toEqual([{ id: 2, aktiv: false }]));

    const inaktiv = screen.getByText('Ordnungsamt').closest('tr') as HTMLElement;
    await userEvent.click(within(inaktiv).getByRole('button', { name: 'Aktivieren' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { id: 2, aktiv: false },
        { id: 3, aktiv: true },
      ]),
    );
  });

  it('die Rückfrage an der zuständigen Leitstelle nennt den Wegfall der Markierung', async () => {
    render(admin);
    await screen.findByText('Polizei Musterstadt');
    const zeile = screen.getByText('ILS Musterkreis').closest('tr') as HTMLElement;
    await userEvent.click(within(zeile).getByRole('button', { name: 'Deaktivieren' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('die Markierung entfällt');
  });

  it('ohne Admin-Recht: Anlegen gesperrt mit Grund, keine Zeilenaktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Polizei Musterstadt');
    expect(screen.getByRole('button', { name: 'Externe Stelle anlegen' })).toBeDisabled();
    expect(screen.getByText(STAMMDATEN_RECHTE_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
