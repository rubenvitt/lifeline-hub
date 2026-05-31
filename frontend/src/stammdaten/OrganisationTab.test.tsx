import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import OrganisationTab from './OrganisationTab';

function renderTab() {
  return renderMitProviders(<OrganisationTab />);
}

describe('OrganisationTab', () => {
  it('lädt Org-Default und speichert Änderung', async () => {
    let patched: unknown = null;
    server.use(
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'feuerwehr' });
      }),
    );

    renderTab();

    const select = await screen.findByLabelText('DV-102-Organisation');
    await userEvent.click(select);
    await userEvent.click(await screen.findByText('Feuerwehr'));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patched).toEqual({ tz_organisation: 'feuerwehr' }));
  });
});
