import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
   * Der Speicherfehler steht an der SEITE (seit Review Welle B: an seinem Paneel), nicht im
   * Toast (H14, LFH-345 · C10). Die zweite
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
    const alert = await within(
      screen.getByRole('region', { name: 'Taktische Zeichen' }),
    ).findByText('Organisation gesperrt');
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
    const alert = await within(screen.getByRole('region', { name: 'Name' })).findByText(
      'Name ist zu lang (höchstens 120 Zeichen)',
    );
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

  /**
   * Ein Logo, das nicht lädt (Datei weg, Abruf gescheitert), stand als kaputter Bildrahmen
   * da. Wie im Druckkopf fällt das Bild weg — hier aber mit Hinweis, weil die Verwaltung der
   * Ort ist, an dem man es behebt. Hochladen/Ersetzen und Entfernen bleiben bedienbar.
   */
  it('nimmt ein Logo, das nicht lädt, weg und sagt es', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () => HttpResponse.json(MIT_LOGO)),
    );
    renderTab();
    const bild = await screen.findByRole('img', { name: 'Logo von DRK' });
    fireEvent.error(bild);
    expect(screen.queryByRole('img', { name: 'Logo von DRK' })).toBeNull();
    expect(screen.getByText(/Das hinterlegte Logo lässt sich nicht anzeigen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logo ersetzen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Logo entfernen' })).toBeEnabled();
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

  /**
   * Ein gescheitertes Entfernen hält den Dialog offen — der Grund gehört IN den Dialog, nicht
   * hinter seine Maske (LFH-535, Bauform `FreigabeDialog`). Und kein Toast: der wäre nach drei
   * Sekunden weg. Gezählt wird die Message-Queue selbst, nicht nur „im Dialog steht es".
   */
  it('zeigt den Grund eines gescheiterten Entfernens im Dialog und räumt ihn beim nächsten Öffnen', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () => HttpResponse.json(MIT_LOGO)),
      http.delete('/api/organisation/logo', () =>
        HttpResponse.json({ error: 'Logo gerade in Verwendung' }, { status: 409 }),
      ),
    );
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Logo entfernen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Logo entfernen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Entfernen' }));
    expect(await within(dialog).findByText('Logo gerade in Verwendung')).toBeInTheDocument();
    expect(within(dialog).getByText('Logo nicht entfernt')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    // Gegenprobe: Abbrechen und neu öffnen — ein frischer Dialog trägt keinen alten Grund.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Logo entfernen' }));
    const zweiter = await screen.findByRole('dialog', { name: 'Logo entfernen?' });
    expect(within(zweiter).queryByText('Logo gerade in Verwendung')).toBeNull();
  });

  /**
   * Drei unabhängige Paneele, drei Speicherwege: jeder Fehler steht an SEINEM Paneel. Vorher
   * zeigte die Seite nur den ersten einer festen Rangfolge — scheiterte erst der Name und
   * dann das Logo, blieb der Logo-Grund unsichtbar.
   */
  it('zeigt jeden Fehler an seinem Paneel, auch wenn zwei Speicherwege nacheinander scheitern', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', () =>
        HttpResponse.json({ error: 'Name abgelehnt' }, { status: 400 }),
      ),
      http.post('/api/organisation/logo', () =>
        HttpResponse.json({ error: 'Kein gültiges PNG' }, { status: 422 }),
      ),
    );
    renderTab();
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.click(screen.getByRole('button', { name: 'Namen speichern' }));
    const namePaneel = screen.getByRole('region', { name: 'Name' });
    expect(await within(namePaneel).findByText('Name abgelehnt')).toBeInTheDocument();

    const datei = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, datei);
    const logoPaneel = screen.getByRole('region', { name: 'Logo' });
    expect(await within(logoPaneel).findByText('Kein gültiges PNG')).toBeInTheDocument();
    // Beide stehen, jeder an seinem Ort — nicht einer von beiden an der Seite.
    expect(within(namePaneel).getByText('Name abgelehnt')).toBeInTheDocument();
    expect(within(logoPaneel).queryByText('Name abgelehnt')).toBeNull();
    expect(within(namePaneel).queryByText('Kein gültiges PNG')).toBeNull();
    // Und kein zweiter Ort daneben (die frühere Seiten-Kette zeigte den Namensfehler doppelt).
    expect(screen.getAllByText('Name abgelehnt')).toHaveLength(1);
    expect(screen.getAllByText('Kein gültiges PNG')).toHaveLength(1);
  });

  /**
   * Der Serverstand erreicht das Namensfeld nach dem Speichern wieder (LFH-342 · C7 (2)):
   * antd setzt `touched` beim Speichern nicht zurück, ein Riegel daran hielt das Feld für den
   * ganzen Besuch fest. Der schärfere Fall: der Server bleibt beim SELBEN Namen (nur
   * Leerzeichen getippt) — dann ändert sich der Serverwert gar nicht.
   */
  it('übernimmt nach dem Speichern wieder den Serverstand ins Namensfeld (auch bei gleichem Namen)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
    );
    renderTab();
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.type(feld, '   ');
    expect(feld).toHaveValue('DRK   ');
    await userEvent.click(screen.getByRole('button', { name: 'Namen speichern' }));
    await waitFor(() => expect(feld).toHaveValue('DRK'));
  });

  it('übernimmt nach dem Speichern auch einen fremd geänderten Namen', async () => {
    let name = 'DRK';
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name, tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', () => {
        // Ein zweiter Admin hat inzwischen umbenannt; der Server hält danach seinen Stand.
        name = 'DRK Kreisverband';
        return HttpResponse.json({ id: 1, name, tz_organisation: 'hilfsorganisation' });
      }),
    );
    renderTab();
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.type(feld, ' KV');
    await userEvent.click(screen.getByRole('button', { name: 'Namen speichern' }));
    await waitFor(() => expect(feld).toHaveValue('DRK Kreisverband'));
  });

  /** Gegenaussage zum Riegel: WÄHREND jemand tippt, überschreibt ein Refetch das Feld nicht. */
  it('überschreibt einen angefangenen Namen nicht durch einen Refetch', async () => {
    let name = 'DRK';
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name, tz_organisation: 'hilfsorganisation' }),
      ),
    );
    const { client } = renderTab();
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.type(feld, ' Nord');
    name = 'Fremd';
    await client.invalidateQueries({ queryKey: ['organisation'] });
    await new Promise((r) => setTimeout(r, 30));
    expect(feld).toHaveValue('DRK Nord');
  });

  /**
   * Die PATCH-Antwort IST der neue Serverstand (volle `OrganisationAnzeige`). Wird nur
   * invalidiert, hält der Cache bis zum Refetch den ALTEN Namen — und sobald der Merker
   * fällt, springt das Feld darauf zurück. Kommt der Refetch nie (hier: er hängt), bleibt
   * der alte Name stehen. Geprüft wird deshalb der Stand OHNE Refetch, nicht der Endzustand.
   */
  it('zeigt nach „Namen speichern" sofort den gespeicherten Namen, auch wenn der Refetch nicht kommt', async () => {
    let gespeichert = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', async () => {
        if (gespeichert) await new Promise(() => {}); // Refetch hängt
        return HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' });
      }),
      http.patch('/api/organisation', () => {
        gespeichert = true;
        return HttpResponse.json({ id: 1, name: 'DRK Neu', tz_organisation: 'hilfsorganisation' });
      }),
    );
    renderTab();
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.clear(feld);
    await userEvent.type(feld, 'DRK Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Namen speichern' }));
    await screen.findByText('Name gespeichert');
    await new Promise((r) => setTimeout(r, 30));
    expect(feld).toHaveValue('DRK Neu');
  });

  /**
   * Die Folge, wenn das Feld auf den alten Namen zurückspringt und der Refetch scheitert:
   * ein zweites „Namen speichern" macht die Umbenennung still rückgängig.
   */
  it('macht die Umbenennung bei gescheitertem Refetch nicht durch erneutes Speichern rückgängig', async () => {
    let gespeichert = false;
    const patches: unknown[] = [];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', () =>
        gespeichert
          ? HttpResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
          : HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' }),
      ),
      http.patch('/api/organisation', async ({ request }) => {
        gespeichert = true;
        const body = (await request.json()) as { name: string };
        patches.push(body);
        return HttpResponse.json({ id: 1, name: body.name, tz_organisation: 'hilfsorganisation' });
      }),
    );
    renderTab();
    const feld = await screen.findByLabelText('Name der Organisation');
    await waitFor(() => expect(feld).toHaveValue('DRK'));
    await userEvent.clear(feld);
    await userEvent.type(feld, 'DRK Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Namen speichern' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    await userEvent.click(screen.getByRole('button', { name: 'Namen speichern' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ name: 'DRK Neu' });
  });

  it('zeigt ein hochgeladenes Logo sofort aus der Antwort, auch wenn der Refetch nicht kommt', async () => {
    let hochgeladen = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/organisation', async () => {
        if (hochgeladen) await new Promise(() => {}); // Refetch hängt
        return HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' });
      }),
      http.post('/api/organisation/logo', () => {
        hochgeladen = true;
        return HttpResponse.json(MIT_LOGO);
      }),
    );
    renderTab();
    await screen.findByRole('button', { name: 'Logo hochladen' });
    const datei = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', {
      type: 'image/png',
    });
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, datei);
    await screen.findByText('Logo gespeichert');
    expect(screen.getByRole('img', { name: 'Logo von DRK' })).toHaveAttribute(
      'src',
      '/api/organisation/logo?v=abc123',
    );
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
