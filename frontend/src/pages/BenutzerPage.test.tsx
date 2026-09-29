import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import BenutzerPage from './BenutzerPage';
import { adminFixture } from '../test/fixtures';

const benutzer = adminFixture;

describe('BenutzerPage', () => {
  it('listet Benutzer', async () => {
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );
    // Benutzername-Zelle (@admin) ist eindeutig — der Name „Admin" kollidiert sonst mit dem Rollen-Tag.
    expect(await screen.findByText('@admin')).toBeInTheDocument();
  });

  it('legt einen neuen Benutzer an', async () => {
    let angelegt = false;
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () =>
        HttpResponse.json(
          angelegt
            ? [
                benutzer(),
                benutzer({
                  id: 2,
                  anzeigename: 'Eva',
                  benutzername: 'eva',
                  system_rolle: 'keiner',
                }),
              ]
            : [benutzer()],
        ),
      ),
      http.post('/api/benutzer', () => {
        angelegt = true;
        return HttpResponse.json(benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva' }), {
          status: 201,
        });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await userEvent.type(screen.getByLabelText('Anzeigename'), 'Eva');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'eva');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim123');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
  });

  it('bearbeitet den Anzeigenamen eines Benutzers', async () => {
    let patchBody: Record<string, unknown> | null = null;
    let bearbeitet = false;
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({
            id: 2,
            anzeigename: bearbeitet ? 'Eva Neu' : 'Eva',
            benutzername: 'eva',
            system_rolle: 'keiner',
          }),
        ]),
      ),
      http.patch('/api/benutzer/2', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        bearbeitet = true;
        return HttpResponse.json(
          benutzer({ id: 2, anzeigename: 'Eva Neu', benutzername: 'eva', system_rolle: 'keiner' }),
        );
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    const evaItem = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaItem).getByRole('button', { name: 'Bearbeiten' }));

    const input = await screen.findByLabelText('Anzeigename');
    await userEvent.clear(input);
    await userEvent.type(input, 'Eva Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toMatchObject({ anzeigename: 'Eva Neu' });
    await waitFor(() => expect(screen.getByText('Eva Neu')).toBeInTheDocument());
  });

  it('reaktiviert einen deaktivierten Benutzer', async () => {
    let patchBody: Record<string, unknown> | null = null;
    let reaktiviert = false;
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({
            id: 2,
            anzeigename: 'Eva',
            benutzername: 'eva',
            system_rolle: 'keiner',
            aktiv: reaktiviert,
          }),
        ]),
      ),
      http.patch('/api/benutzer/2', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        reaktiviert = true;
        return HttpResponse.json(
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' }),
        );
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    const evaItem = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    // Deaktivierter Nutzer zeigt keinen Deaktivieren-Button, aber Reaktivieren.
    await userEvent.click(within(evaItem).getByRole('button', { name: 'Reaktivieren' }));

    await waitFor(() => expect(patchBody).toEqual({ aktiv: true }));
    // Nach dem Refetch rendert die Tabelle neu — Zeile frisch holen statt stale Referenz.
    await waitFor(() => {
      const zeile = screen.getByText('Eva').closest('tr') as HTMLElement;
      expect(within(zeile).queryByText('deaktiviert')).not.toBeInTheDocument();
    });
  });

  it('sperrt beim Reaktivieren nur die geklickte Zeile, nicht alle', async () => {
    const patchIds: number[] = [];
    // Default-No-op: der Executor läuft synchron und ersetzt ihn sofort durch den echten Resolver.
    let freigeben: () => void = () => {};
    const blockiert = new Promise<void>((res) => {
      freigeben = () => res();
    });
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({
            id: 2,
            anzeigename: 'Eva',
            benutzername: 'eva',
            system_rolle: 'keiner',
            aktiv: false,
          }),
          benutzer({
            id: 3,
            anzeigename: 'Max',
            benutzername: 'max',
            system_rolle: 'keiner',
            aktiv: false,
          }),
        ]),
      ),
      http.patch('/api/benutzer/:id', async ({ params }) => {
        patchIds.push(Number(params.id));
        await blockiert; // erste Anfrage bewusst in-flight halten
        return HttpResponse.json(benutzer({ id: Number(params.id), aktiv: true }));
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    const evaItem = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    const maxItem = (await screen.findByText('Max')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaItem).getByRole('button', { name: 'Reaktivieren' }));
    // Trotz laufender erster Reaktivierung muss die zweite Zeile klickbar bleiben.
    await userEvent.click(within(maxItem).getByRole('button', { name: 'Reaktivieren' }));

    await waitFor(() => expect(patchIds).toEqual([2, 3]));
    freigeben();
  });

  /**
   * „Deaktivieren" zeigt eine zeilenweise Ladeanzeige: ohne Rückmeldung lädt eine unumkehrbar
   * wirkende Aktion zum zweiten Klick ein. Die zweite Zeile ist die schärfere Hälfte — ein
   * ungescoptes `loading={deaktivieren.isPending}` erfüllte die erste ebenfalls.
   */
  it('zeigt den Ladezustand beim Deaktivieren NUR an der geklickten Zeile', async () => {
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' }),
          benutzer({ id: 3, anzeigename: 'Max', benutzername: 'max', system_rolle: 'keiner' }),
        ]),
      ),
      http.post('/api/benutzer/:id/deaktivieren', () => new Promise(() => {})),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    const evaZeile = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    const maxZeile = (await screen.findByText('Max')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaZeile).getByRole('button', { name: 'Deaktivieren' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ja' }));

    await waitFor(() =>
      expect(within(evaZeile).getByRole('button', { name: /Deaktivieren/ })).toHaveClass(
        'ant-btn-loading',
      ),
    );
    expect(within(maxZeile).getByRole('button', { name: 'Deaktivieren' })).not.toHaveClass(
      'ant-btn-loading',
    );
  });

  // Geprüft wird, was Suche, Sortierung und Statusfilter mit den Zeilen tun. Die stehende Kopfzeile
  // schiebt eine verborgene Messzeile als erste Körperzeile ein, deshalb `tr.ant-table-row`.
  it('sucht, sortiert und filtert die Benutzerliste', async () => {
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({
            id: 2,
            anzeigename: 'Eva',
            benutzername: 'eva',
            system_rolle: 'keiner',
            aktiv: false,
          }),
        ]),
      ),
    );
    const { container } = renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );
    await screen.findByText('@eva');
    const namen = () =>
      Array.from(container.querySelectorAll('tr.ant-table-row td:first-child')).map(
        (z) => z.textContent,
      );
    expect(namen()).toEqual(['Admin', 'Eva']);

    // Gesucht wird der Rohwert: „eva", nicht das gerenderte „@eva".
    const feld = screen.getByPlaceholderText('Name oder Benutzername');
    await userEvent.type(feld, 'eva');
    await waitFor(() => expect(namen()).toEqual(['Eva']));
    await userEvent.clear(feld);
    await waitFor(() => expect(namen()).toHaveLength(2));

    // Zweimal klicken: aufsteigend ist hier die Serverreihenfolge, erst absteigend beweist das
    // Sortieren.
    const kopf = screen.getByRole('columnheader', { name: /Name/ });
    await userEvent.click(kopf);
    await userEvent.click(kopf);
    await waitFor(() => expect(namen()).toEqual(['Eva', 'Admin']));

    // Der Filterkorb hängt in einem Portal an `document.body`, nicht im Container.
    const status = screen.getByRole('columnheader', { name: /Status/ });
    await userEvent.click(status.querySelector('.ant-table-filter-trigger') as HTMLElement);
    const korb = document.querySelector('.ant-table-filter-dropdown') as HTMLElement;
    await userEvent.click(within(korb).getByText('deaktiviert'));
    // `test/utils.tsx` montiert `ConfigProvider` ohne Locale — die Schaltfläche heißt „OK".
    await userEvent.click(within(korb).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(namen()).toEqual(['Eva']));
  });

  /**
   * Partnerpaar: die negative Hälfte allein belegte nichts (ein geänderter Leertext machte sie
   * trivial grün). Erst die positive Hälfte mit gleichem Literal macht sie zu einer Aussage über
   * die Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Benutzer')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    expect(await screen.findByText('Noch keine Benutzer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('leitet Nicht-Admins weg von der Benutzerverwaltung', async () => {
    server.use(
      meHandler(benutzer({ system_rolle: 'keiner' })),
      http.get('/api/benutzer', () =>
        HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );
    expect(await screen.findByText('Einsatz-Liste')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Benutzer anlegen' })).not.toBeInTheDocument();
  });

  /**
   * Beide Dialoge stehen unbedingt im Baum, und antd lässt den geschlossenen als `role="dialog"`
   * stehen. Über den zugänglichen Namen sind sie nicht zu trennen: `useId` aus `@rc-component/util`
   * liefert unter `NODE_ENV=test` die Konstante `'test-id'`, beide `aria-labelledby` zeigen auf
   * dasselbe Element. Unterschieden wird an der sichtbaren Überschrift.
   */
  function dialogMitTitel(titel: string): HTMLElement {
    const treffer = screen
      .getAllByRole('dialog')
      .filter((d) => d.querySelector('.ant-modal-title')?.textContent === titel);
    if (treffer.length !== 1) {
      throw new Error(`Erwartet genau EIN Modal „${titel}", gefunden ${treffer.length}`);
    }
    return treffer[0];
  }

  /**
   * Zwei Benutzer, damit „Bearbeiten"-Zeilen unterscheidbar sind; die Prüfungen brauchen Anlegen-
   * und Bearbeiten-Dialog.
   */
  function renderMitZwei() {
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' }),
          benutzer({ id: 3, anzeigename: 'Ben', benutzername: 'ben', system_rolle: 'keiner' }),
        ]),
      ),
    );
    return renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );
  }

  /**
   * Die Zusicherung von `ErfassungsModal` für beide Dialoge: Enter kommt aus der nativen
   * Formularübermittlung und greift nur, wenn der Knopf im `<form>` liegt. Per Tastendruck nicht
   * belegbar — beide Masken tragen `Select`, das bei Enter `preventDefault()` ruft. Beide Hälften
   * sind die Aussage: keine antd-Fußzeile und der Knopf hat ein `form` als Vorfahr.
   */
  it('beide Dialoge tragen keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    renderMitZwei();
    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await screen.findByRole('dialog');
    const anlegen = dialogMitTitel('Neuen Benutzer anlegen');
    expect(anlegen.querySelector('.ant-modal-footer')).toBeNull();
    expect(within(anlegen).getByRole('button', { name: 'Anlegen' }).closest('form')).not.toBeNull();
    await userEvent.click(within(anlegen).getByRole('button', { name: 'Abbrechen' }));

    const evaZeile = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaZeile).getByRole('button', { name: 'Bearbeiten' }));
    const bearbeiten = dialogMitTitel('Benutzer bearbeiten');
    expect(bearbeiten.querySelector('.ant-modal-footer')).toBeNull();
    expect(
      within(bearbeiten).getByRole('button', { name: 'Speichern' }).closest('form'),
    ).not.toBeNull();
  });

  /**
   * Den Fokus setzt die Hülle, kein handgesetztes `autoFocus`.
   *
   * Bewusst zwei Tests: beide Masken haben ein Feld `anzeigename`, antds `Form.Item` leitet daraus
   * die DOM-`id` ab. In jsdom räumt `destroyOnHidden` den geschlossenen Dialog nicht ab (die
   * Schließanimation läuft nie zu Ende), und `getByLabelText` löste über `for` auf die Eingabe des
   * falschen Dialogs auf.
   */
  it('setzt im Anlegen-Dialog den Fokus ins erste Feld', async () => {
    renderMitZwei();
    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    const anlegen = await screen.findByRole('dialog');
    await waitFor(() => expect(within(anlegen).getByLabelText('Anzeigename')).toHaveFocus());
  });

  it('setzt im Bearbeiten-Dialog den Fokus ins erste Feld', async () => {
    renderMitZwei();
    const evaZeile = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaZeile).getByRole('button', { name: 'Bearbeiten' }));
    const bearbeiten = await screen.findByRole('dialog');
    await waitFor(() => expect(within(bearbeiten).getByLabelText('Anzeigename')).toHaveFocus());
  });

  /**
   * Die Hülle setzt auf allen vier Auswegen zurück, die Vorbelegung läuft über einen Effekt. Hier
   * fiele auf, wenn die Vorbelegung fehlte: der zweite Benutzer trüge Namen und Rollen des ersten.
   *
   * Bewusst mit Wertunterschied in allen drei Feldern — sonst blieben die Rollen-Selects ungeprüft.
   */
  it('zeigt beim Wechsel von Benutzer A zu Benutzer B wirklich B', async () => {
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer({
            id: 2,
            anzeigename: 'Eva',
            benutzername: 'eva',
            system_rolle: 'admin',
            org_rolle: 'fuehrungskraft',
          }),
          benutzer({
            id: 3,
            anzeigename: 'Ben',
            benutzername: 'ben',
            system_rolle: 'keiner',
            org_rolle: 'keine',
          }),
        ]),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    const evaZeile = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaZeile).getByRole('button', { name: 'Bearbeiten' }));
    await screen.findByRole('dialog');
    const ersterDialog = dialogMitTitel('Benutzer bearbeiten');
    expect(within(ersterDialog).getByLabelText('Anzeigename')).toHaveValue('Eva');
    // Der gewählte Wert eines antd-`Select` steht im sichtbaren Auswahl-Element, nicht
    // im `<input>` — der zugängliche Name der Combobox ist die Feldbeschriftung.
    expect(within(ersterDialog).getByText('Admin')).toBeInTheDocument();
    expect(within(ersterDialog).getByText(/Führungskraft/)).toBeInTheDocument();
    await userEvent.click(within(ersterDialog).getByRole('button', { name: 'Abbrechen' }));

    const benZeile = (await screen.findByText('Ben')).closest('tr') as HTMLElement;
    await userEvent.click(within(benZeile).getByRole('button', { name: 'Bearbeiten' }));
    const zweiterDialog = dialogMitTitel('Benutzer bearbeiten');
    await waitFor(() =>
      expect(within(zweiterDialog).getByLabelText('Anzeigename')).toHaveValue('Ben'),
    );
    expect(within(zweiterDialog).getByText('Benutzer')).toBeInTheDocument();
    expect(within(zweiterDialog).getByText('Keine')).toBeInTheDocument();
    expect(within(zweiterDialog).queryByText('Admin')).toBeNull();
    expect(within(zweiterDialog).queryByText(/Führungskraft/)).toBeNull();
  });

  /**
   * `onErfassen` bekommt `mutateAsync`, nicht `mutate` — sonst löste die Hülle den Erfolgszweig
   * aus, während der Server ablehnt. Geprüft wird das Ergebnis.
   */
  it('lässt nach einer Ablehnung den Anlegen-Dialog samt Wortlaut stehen', async () => {
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
      http.post('/api/benutzer', () =>
        HttpResponse.json({ error: 'Benutzername bereits vergeben' }, { status: 422 }),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
        <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await userEvent.type(screen.getByLabelText('Anzeigename'), 'Eva');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim123');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await screen.findByText('Benutzername bereits vergeben');
    const dialog = dialogMitTitel('Neuen Benutzer anlegen');
    expect(within(dialog).getByLabelText('Anzeigename')).toHaveValue('Eva');
    expect(within(dialog).getByLabelText('Benutzername')).toHaveValue('admin');
  });

  /**
   * Die tragende Prüfung des Collapse-Umbaus: ohne `forceRender` sind die beiden Rollen-Selects
   * nicht montiert, und `onFinish` liefert nur montierte Felder. `system_rolle` und `org_rolle`
   * sind im DTO optional — sie fielen lautlos aus dem Rumpf, und der Server setzte seine Vorgabe
   * statt der zugesagten.
   */
  it('schickt die Rollen-Vorgaben mit, auch wenn niemand aufklappt', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
      http.post('/api/benutzer', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(benutzer({ id: 2 }), { status: 201 });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await userEvent.type(screen.getByLabelText('Anzeigename'), 'Eva');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'eva');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim123');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toEqual({
      anzeigename: 'Eva',
      benutzername: 'eva',
      passwort: 'geheim123',
      system_rolle: 'keiner',
      org_rolle: 'keine',
    });
  });

  /**
   * Gegenprobe: eine aufgeklappt gewählte Rolle schlägt die Vorgabe — belegt, dass der Speicher
   * gelesen wird, in dem auch die Wahl landet.
   */
  it('eine aufgeklappt gewählte Rolle kommt gewählt an', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      meHandler(benutzer()),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
      http.post('/api/benutzer', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(benutzer({ id: 2 }), { status: 201 });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/admin/benutzer" element={<BenutzerPage />} />
      </Routes>,
      { route: '/admin/benutzer' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await userEvent.type(screen.getByLabelText('Anzeigename'), 'Eva');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'eva');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim123');
    const dialog = dialogMitTitel('Neuen Benutzer anlegen');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.click(await within(dialog).findByLabelText('Org-Rolle'));
    // Die Optionsliste hängt im Portal, nicht im Dialog; gegriffen wird der echte Options-Knoten
    // (antd hört auf dessen Klick).
    await userEvent.click(await screen.findByText('Führungskraft (darf Einsätze anlegen)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toMatchObject({ system_rolle: 'keiner', org_rolle: 'fuehrungskraft' });
  });

  /**
   * Das Feldbudget des Anlegen-Dialogs: drei sichtbare Felder statt fünf.
   *
   * Gezählt werden `.ant-form-item`-Knoten, nicht `role="textbox"` (die Rollen sind `Select`). Die
   * zweite Hälfte ist Pflicht: „höchstens drei" erfüllte auch ein Dialog ohne Felder.
   */
  it('der Anlegen-Dialog zeigt drei Felder und deckt zwei beim Aufklappen auf', async () => {
    renderMitZwei();
    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await screen.findByRole('dialog');
    const dialog = dialogMitTitel('Neuen Benutzer anlegen');

    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(3);

    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(5));
  });
});
