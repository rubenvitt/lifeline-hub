import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import OrganisationTab from './OrganisationTab';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-26 10:00:00',
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
    await waitFor(() =>
      expect(screen.queryByText('Organisation gesperrt')).not.toBeInTheDocument(),
    );
  });
});

/**
 * ── NAME UND LOGO (LFH-22, design.md D9) ────────────────────────────────────────
 *
 * Der Name steht im Druckkopf jedes Ausdrucks; das Logo daneben. Beide pflegt der Admin
 * hier. Der Name speichert im eigenen `<form>` (Enter sendet), sein Fehler steht an der
 * Seite; das Logo hat eine Vorprüfung im Client (maßgeblich bleibt der Server) und eine
 * Rückfrage vor dem Entfernen, weil Entfernen unumkehrbar ist (LFH-363).
 */
describe('OrganisationTab — Name und Logo (LFH-22)', () => {
  const MIT_LOGO = {
    id: 1,
    name: 'DRK',
    tz_organisation: 'hilfsorganisation',
    logo: {
      mime: 'image/png',
      groesse: 2048,
      sha256: 'abc123',
      geaendert_at: '2026-09-25 08:00:00',
    },
  };

  it('speichert den Namen per Enter und schickt nur den Namen', async () => {
    let patched: unknown = null;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ id: 1, name: 'DRK KV Musterstadt', tz_organisation: null });
      }),
    );
    renderTab();
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.clear(feld);
    await userEvent.type(feld, 'DRK KV Musterstadt{Enter}');
    await waitFor(() => expect(patched).toEqual({ name: 'DRK KV Musterstadt' }));
  });

  it('zeigt einen abgelehnten Namen an der Seite, nicht nur im Toast', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', () =>
        HttpResponse.json({ error: 'Name ist zu lang (höchstens 120 Zeichen)' }, { status: 400 }),
      ),
    );
    renderTab();
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.click(screen.getByRole('button', { name: 'Namen speichern' }));
    const alert = await screen.findByText('Name ist zu lang (höchstens 120 Zeichen)');
    expect(alert.closest('.ant-message')).toBeNull();
  });

  it('Nicht-Admin: Namen speichern und Logo hochladen gesperrt, Grund genannt', async () => {
    server.use(http.get('/api/organisation', () => HttpResponse.json(MIT_LOGO)));
    renderTab();
    expect(await screen.findByText(STAMMDATEN_RECHTE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Namen speichern' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'Logo ersetzen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Logo entfernen' })).toBeDisabled();
  });

  it('zeigt ein hinterlegtes Logo mit dem sha256 als Cache-Brecher', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () => HttpResponse.json(MIT_LOGO)),
    );
    renderTab();
    const bild = await screen.findByRole('img', { name: 'Logo von DRK' });
    expect(bild).toHaveAttribute('src', '/api/organisation/logo?v=abc123');
  });

  it('lädt ein PNG als Multipart-Feld `datei` hoch und invalidiert die Organisation', async () => {
    // Roh gelesen statt über `request.formData()`: undicis Multipart-Parser lehnt die
    // jsdom-`File` ab (gemessen: ERR_ASSERTION in `multipartFormDataParser`), und undici
    // serialisiert sie ohne Dateinamen. Geprüft wird hier deshalb nur Feldname und
    // Multipart-Form; dass genau die gewählte Datei im Feld `datei` steht, belegt
    // `api/organisation.test.ts` am `FormData` selbst.
    let koerper = '';
    let typ = '';
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.post('/api/organisation/logo', async ({ request }) => {
        typ = request.headers.get('content-type') ?? '';
        koerper = await request.text();
        return HttpResponse.json(MIT_LOGO);
      }),
    );
    const { client } = renderTab();
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    await screen.findByRole('button', { name: 'Logo hochladen' });
    const datei = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', {
      type: 'image/png',
    });
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, datei);
    await waitFor(() => expect(koerper).toContain('name="datei"'));
    expect(typ).toMatch(/^multipart\/form-data; boundary=/);
    await waitFor(() => expect(invalidiert).toHaveBeenCalledWith({ queryKey: ['organisation'] }));
  });

  it('lehnt 2 MiB schon im Client ab und sagt es an der Seite', async () => {
    let hochgeladen = 0;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.post('/api/organisation/logo', () => {
        hochgeladen += 1;
        return HttpResponse.json(MIT_LOGO);
      }),
    );
    renderTab();
    await screen.findByRole('button', { name: 'Logo hochladen' });
    const gross = new File([new Uint8Array(2 * 1024 * 1024)], 'gross.png', { type: 'image/png' });
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, gross);
    const hinweis = await screen.findByText('Das Logo ist zu groß (höchstens 1 MiB).');
    expect(hinweis.closest('.ant-message')).toBeNull();
    expect(hochgeladen).toBe(0);
  });

  it('fragt vor dem Entfernen nach (roter Bestätigungsknopf); Abbrechen sendet nichts', async () => {
    let geloescht = 0;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () => HttpResponse.json(MIT_LOGO)),
      http.delete('/api/organisation/logo', () => {
        geloescht += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { client } = renderTab();
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(await screen.findByRole('button', { name: 'Logo entfernen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Logo entfernen?' });
    const bestaetigen = within(dialog).getByRole('button', { name: 'Entfernen' });
    expect(bestaetigen).toHaveClass('ant-btn-dangerous');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(geloescht).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Logo entfernen' }));
    const zweiter = await screen.findByRole('dialog', { name: 'Logo entfernen?' });
    await userEvent.click(within(zweiter).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(geloescht).toBe(1));
    await waitFor(() => expect(invalidiert).toHaveBeenCalledWith({ queryKey: ['organisation'] }));
  });

  it('invalidiert die Organisation auch nach dem Umbenennen', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
    );
    const { client } = renderTab();
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.click(screen.getByRole('button', { name: 'Namen speichern' }));
    await waitFor(() => expect(invalidiert).toHaveBeenCalledWith({ queryKey: ['organisation'] }));
  });
});
