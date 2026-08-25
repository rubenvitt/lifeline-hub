import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import OrganisationTab from './OrganisationTab';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function renderTab() {
  return renderMitProviders(<OrganisationTab />);
}

describe('OrganisationTab', () => {
  it('lädt Org-Default und speichert Änderung', async () => {
    let patched: unknown = null;
    server.use(
      // Seit LFH-346 · A2 hat diese Sektion ein Rechte-Gate: ohne Admin sind Feld und
      // Knopf gesperrt. Der MSW-Default liefert 401 → benutzer=null → kein Admin.
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
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

  /**
   * LFH-346 · A2 (M45): die einzige Sektion ohne Gate. Geprüft wird der KNOPF, nicht die
   * Abwesenheit des Knopfs — ein fehlender Knopf ist von „diese Seite kann das gar nicht"
   * nicht zu unterscheiden (M16), und „ausgegraut" allein ist eine Ein-Kanal-Aussage
   * (WCAG 1.4.1). Deshalb steht die Textzusicherung daneben.
   */
  it('Nicht-Admin: Knopf gesperrt, Grund genannt, kein Speichern', async () => {
    let gerufen = 0;
    server.use(
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', () => {
        gerufen += 1;
        return HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'feuerwehr' });
      }),
    );

    renderTab();

    expect(await screen.findByText(STAMMDATEN_RECHTE_TEXT)).toBeInTheDocument();
    const knopf = screen.getByRole('button', { name: 'Speichern' });
    expect(knopf).toBeDisabled();
    await userEvent.click(knopf);
    expect(gerufen).toBe(0);
  });

  /**
   * Der Speicherfehler steht an der SEITE, nicht im Toast (H14, LFH-345 · C10). Die zweite
   * Hälfte — er verschwindet beim nächsten Absenden — ist die, die einen stehenbleibenden
   * Alert auffliegen lässt; ohne sie wäre ein Alert, der nie geht, genauso grün.
   */
  it('zeigt einen Speicherfehler dauerhaft an der Seite und räumt ihn beim nächsten Versuch', async () => {
    let scheitern = true;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', () =>
        scheitern
          ? HttpResponse.json({ error: 'Organisation gesperrt' }, { status: 422 })
          : HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'feuerwehr' }),
      ),
    );

    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    const alert = await screen.findByText('Organisation gesperrt');
    // NICHT in antds Message-Queue — die räumt sich nach ~3 s von selbst weg.
    expect(alert.closest('.ant-message')).toBeNull();

    scheitern = false;
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByText('Organisation gesperrt')).not.toBeInTheDocument());
  });
});
