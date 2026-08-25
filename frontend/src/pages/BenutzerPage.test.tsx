import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import BenutzerPage from './BenutzerPage';

function benutzer(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
    org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', ...over,
  };
}

describe('BenutzerPage', () => {
  it('listet Benutzer', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );
    // Benutzername-Zelle (@admin) ist eindeutig — der Name „Admin" kollidiert sonst mit dem Rollen-Tag.
    expect(await screen.findByText('@admin')).toBeInTheDocument();
  });

  it('legt einen neuen Benutzer an', async () => {
    let angelegt = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json(angelegt ? [benutzer(), benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' })] : [benutzer()]),
      ),
      http.post('/api/benutzer', () => {
        angelegt = true;
        return HttpResponse.json(benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva' }), {
          status: 201,
        });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
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
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
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
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
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
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
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
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
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
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner', aktiv: false }),
          benutzer({ id: 3, anzeigename: 'Max', benutzername: 'max', system_rolle: 'keiner', aktiv: false }),
        ]),
      ),
      http.patch('/api/benutzer/:id', async ({ params }) => {
        patchIds.push(Number(params.id));
        await blockiert; // erste Anfrage bewusst in-flight halten
        return HttpResponse.json(benutzer({ id: Number(params.id), aktiv: true }));
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
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
   * LFH-346 · A1: „Deaktivieren" trug ÜBERHAUPT keine Ladeanzeige — anders als
   * „Reaktivieren" daneben, das seit jeher zeilenweise scopt. Ein Klick auf eine
   * unumkehrbar wirkende Aktion ohne jede Rückmeldung lädt zum zweiten Klick ein.
   *
   * Die zweite Zeile ist die schärfere Hälfte: ein ungescoptes
   * `loading={deaktivieren.isPending}` erfüllte die erste Erwartung ebenfalls.
   */
  it('zeigt den Ladezustand beim Deaktivieren NUR an der geklickten Zeile', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
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
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
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

  // Ordnung statt bloßer Anwesenheit: geprüft wird, was Suche, Sortierung und Statusfilter mit
  // den Zeilen TUN. Die stehende Kopfzeile schiebt eine verborgene Messzeile als erste
  // Körperzeile ein, deshalb die Verengung auf `tr.ant-table-row`.
  it('sucht, sortiert und filtert die Benutzerliste', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner', aktiv: false }),
        ]),
      ),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
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

    // Zweimal klicken: aufsteigend ist hier die Serverreihenfolge, erst absteigend beweist,
    // dass wirklich sortiert wird.
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
   * Das Partnerpaar zu AK4 (LFH-331 · B3). Die negative Hälfte allein belegte nichts:
   * änderte man den Leertext beim Umbau, wäre sie auch im Leerfall trivial grün. Erst
   * die positive Hälfte darunter — gleiches Literal, gleiche Datei — macht sie zu einer
   * Aussage über die Zustandsweiche statt über die Schreibweise eines Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Benutzer')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    expect(await screen.findByText('Noch keine Benutzer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('leitet Nicht-Admins weg von der Benutzerverwaltung', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...benutzer(), system_rolle: 'keiner' }),
      ),
      http.get('/api/benutzer', () => HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );
    expect(await screen.findByText('Einsatz-Liste')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Benutzer anlegen' })).not.toBeInTheDocument();
  });

  /**
   * Seit LFH-346 · A6 stehen BEIDE Dialoge unbedingt im Baum, und antd lässt den
   * geschlossenen als `role="dialog"` stehen. Über den zugänglichen Namen sind sie
   * NICHT zu trennen: `@rc-component/util`s `useId` liefert unter `NODE_ENV=test`
   * die Konstante `'test-id'` (`hooks/useId.js:57`) — beide `aria-labelledby` zeigen
   * damit auf dasselbe Element, und `getByRole('dialog', { name })` griffe stets den
   * ersten. Unterschieden wird deshalb an der sichtbaren Überschrift.
   */
  function dialogMitTitel(titel: string): HTMLElement {
    const treffer = screen.getAllByRole('dialog')
      .filter((d) => d.querySelector('.ant-modal-title')?.textContent === titel);
    if (treffer.length !== 1) {
      throw new Error(`Erwartet genau EIN Modal „${titel}", gefunden ${treffer.length}`);
    }
    return treffer[0];
  }

  /**
   * Zwei Benutzer, damit „Bearbeiten"-Zeilen unterscheidbar sind. Eigene Hülle, weil
   * die Prüfungen unten den Anlegen- UND den Bearbeiten-Dialog brauchen.
   */
  function renderMitZwei() {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' }),
          benutzer({ id: 3, anzeigename: 'Ben', benutzername: 'ben', system_rolle: 'keiner' }),
        ]),
      ),
    );
    return renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );
  }

  /**
   * LFH-346 · A6. DIE Zusicherung des Umbaus auf `ErfassungsModal`, für BEIDE Dialoge
   * dieser Seite: Enter kommt aus der eingebauten Formularübermittlung des Browsers,
   * und die greift nur, wenn der Knopf IM `<form>` liegt. Per Tastendruck ist das hier
   * nicht belegbar — beide Masken tragen `Select`, und `@rc-component/select` ruft bei
   * jedem Enter `preventDefault()`. Beide Hälften zusammen sind die Aussage: keine
   * antd-Fusszeile (dort stünde der Knopf als DOM-Geschwister ausserhalb, Befund H69)
   * UND der Knopf hat tatsächlich ein `form` als Vorfahr. Mutationsprobe: dreht man
   * auf `<Modal onOk okText="…">` zurück, fallen beide Abfragen.
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
    expect(within(bearbeiten).getByRole('button', { name: 'Speichern' }).closest('form'))
      .not.toBeNull();
  });

  /**
   * Die zweite Zusicherung der Hülle. Bis hierher trugen BEIDE Masken ein
   * handgesetztes `autoFocus` am ersten Feld; das ist weg, den Fokus setzt die Hülle.
   * Zwei Quellen für denselben Fokus wären eine zu viel.
   *
   * BEWUSST ZWEI Tests statt einem: beide Masken haben ein Feld `anzeigename`, und
   * antds `Form.Item` leitet daraus die DOM-`id` ab. In jsdom räumt `destroyOnHidden`
   * den geschlossenen Dialog nicht ab (die Schliessanimation läuft dort nie zu Ende) —
   * beide Eingaben stünden gleichzeitig mit derselben `id` im Baum, und
   * `getByLabelText` löste über `for` auf die des FALSCHEN Dialogs auf. Ein Test, der
   * beide nacheinander öffnet, scheitert daran und nicht am Fokus.
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
   * Der Sonderfall des Umbaus. Bis LFH-346 · A6 hängte der Bearbeiten-Dialog über
   * `key={zuBearbeiten.id}` am `<Form>` einen frischen Baum ein — die Hülle setzt
   * stattdessen selbst auf allen vier Auswegen zurück, und die Vorbelegung läuft
   * über einen Effekt. Diese Prüfung ist die Stelle, an der auffiele, wenn beim
   * Wegfall des `key` die Vorbelegung mit verschwände: der zweite Benutzer trüge
   * dann Namen und Rollen des ersten.
   *
   * Bewusst mit einem WERTUNTERSCHIED in allen drei Feldern — ein Vorrat, in dem
   * sich nur der Name unterscheidet, liesse die beiden Rollen-Selects ungeprüft.
   */
  it('zeigt beim Wechsel von Benutzer A zu Benutzer B wirklich B', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer({
            id: 2, anzeigename: 'Eva', benutzername: 'eva',
            system_rolle: 'admin', org_rolle: 'fuehrungskraft',
          }),
          benutzer({
            id: 3, anzeigename: 'Ben', benutzername: 'ben',
            system_rolle: 'keiner', org_rolle: 'keine',
          }),
        ]),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
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
   * `onErfassen` bekommt `mutateAsync`, nicht `mutate` — sonst löste die Hülle den
   * Erfolgszweig aus, während der Server ablehnt: Felder leer, Dialog zu, kein Konto.
   * Geprüft wird das Ergebnis, nicht die Schreibweise.
   */
  it('lässt nach einer Ablehnung den Anlegen-Dialog samt Wortlaut stehen', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
      http.post('/api/benutzer', () =>
        HttpResponse.json({ error: 'Benutzername bereits vergeben' }, { status: 422 })),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
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
   * LFH-346 · A8, Befund N20. Die tragende Prüfung des Collapse-Umbaus — nicht die
   * Zählung darunter: beide Hälften der Zählung stünden grün, während der Rumpf zwei
   * Felder verliert.
   *
   * Ohne `forceRender` sind die beiden Rollen-Selects nicht montiert, und `onFinish`
   * liefert nur montierte Felder. `system_rolle` und `org_rolle` sind im DTO optional
   * — sie fielen also lautlos aus dem Rumpf, und der Server setzte SEINE Vorgabe
   * statt der, die die Maske eingeklappt zusagt. Kein Fehler, kein roter Test.
   */
  it('schickt die Rollen-Vorgaben mit, auch wenn niemand aufklappt', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
      http.post('/api/benutzer', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(benutzer({ id: 2 }), { status: 201 });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
        </Routes>
      </AuthProvider>,
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
   * Die Gegenprobe: eine aufgeklappt GEWÄHLTE Rolle schlägt die Vorgabe. Ohne sie
   * belegte die Prüfung darüber nur, dass irgendwoher zwei Vorgabewerte kommen —
   * nicht, dass der Speicher gelesen wird, in dem auch die Wahl landet.
   */
  it('eine aufgeklappt gewählte Rolle kommt gewählt an', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
      http.post('/api/benutzer', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(benutzer({ id: 2 }), { status: 201 });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await userEvent.type(screen.getByLabelText('Anzeigename'), 'Eva');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'eva');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim123');
    const dialog = dialogMitTitel('Neuen Benutzer anlegen');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.click(await within(dialog).findByLabelText('Org-Rolle'));
    // Die Optionsliste hängt im Portal, nicht im Dialog — gegriffen wird sie global,
    // und zwar über den echten Options-Knoten (antd hört auf dessen Klick).
    await userEvent.click(await screen.findByText('Führungskraft (darf Einsätze anlegen)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toMatchObject({ system_rolle: 'keiner', org_rolle: 'fuehrungskraft' });
  });

  /**
   * Das Feldbudget des Anlegen-Dialogs (LFH-346 · A8): drei sichtbare Felder statt
   * fünf. Der Bearbeiten-Dialog hat drei und bleibt unangetastet.
   *
   * Gezählt werden `.ant-form-item`-Knoten, nicht `role="textbox"` — die beiden
   * Rollen sind `Select` und fehlten in der Rollenzählung. Die zweite Hälfte ist
   * Pflicht: „höchstens drei" allein erfüllte auch ein Dialog ganz ohne Felder.
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
