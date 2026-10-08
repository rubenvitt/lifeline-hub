import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from 'antd';
import { meHandler, server } from '../test/server';
import { benutzerFixture } from '../test/fixtures';
import { LETZTE_EINSATZLEITUNG_TEXT } from '../stammdaten/rechteText';
import { einsatzKeys } from '../api/queryKeys';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import MitgliederAbschnitt from './MitgliederAbschnitt';

// Katalog und Besetzung stehen fest, statt über das Netz zu kommen (LFH-549).
vi.mock('../fuehrung/useFunktionsVorschlaege', async () => ({
  useFunktionsVorschlaege: (await import('../test/fuehrungsfunktionen')).vorschlaegeFuer,
}));

/** Das Auswahlfeld der Führungsstelle (ein Wert: Katalogwahl oder Freitext, LFH-549). */
function stellenFeld(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Führungsstelle' });
}

/** Der gewählte Wert im offenen Dialog. */
function stellenWert(): string | null | undefined {
  return within(screen.getByRole('dialog')).queryByText(
    (_, el) => el?.classList.contains('ant-select-selection-item') ?? false,
  )?.textContent;
}

function mitglied(over: Partial<Record<string, unknown>> = {}) {
  return {
    benutzer_id: 2,
    anzeigename: 'Eva Einsatz',
    benutzername: 'eva',
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-05-23 10:00:00',
    ...over,
  };
}

describe('MitgliederAbschnitt', () => {
  it('LFH-461 Review: Abbrechen verwirft Eingaben; erneut öffnen fokussiert den gespeicherten Wert', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () =>
        HttpResponse.json([mitglied({ fuehrungsstelle: 'Gespeicherte Stelle' })]),
      ),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
    );
    const ausloeser = await screen.findByRole('button', {
      name: 'Führungsstelle für Eva Einsatz bearbeiten',
    });
    await userEvent.click(ausloeser);
    await waitFor(() => expect(stellenFeld()).toHaveFocus());
    expect(stellenWert()).toBe('Gespeicherte Stelle');
    // Eine neue Eingabe ersetzt den gespeicherten Wert (EIN Wert je Feld).
    await userEvent.type(stellenFeld(), 'Verworfene Eingabe', { skipClick: true });
    // Verlassen übernimmt den Tipptext (Tags-Modus), wie ein Klick auf „Speichern“.
    await userEvent.tab();
    expect(stellenWert()).toBe('Verworfene Eingabe');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(ausloeser);
    expect(stellenWert()).toBe('Gespeicherte Stelle');
    await waitFor(() => expect(stellenFeld()).toHaveFocus());
  });

  it('LFH-461 Review: verspäteter Speicherabschluss aktualisiert nur den ursprünglichen Einsatz', async () => {
    let freigeben!: () => void;
    const antwort = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    let angefragt!: () => void;
    const anfrage = new Promise<void>((resolve) => {
      angefragt = resolve;
    });
    server.use(
      http.get('/api/einsaetze/:id/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
      http.put('/api/einsaetze/7/mitglieder/2', async () => {
        angefragt();
        await antwort;
        return HttpResponse.json([mitglied({ fuehrungsstelle: 'Stelle 7' })]);
      }),
    );
    const ansicht = (id: number) => (
      <MitgliederAbschnitt key={id} einsatzId={id} darfVerwalten darfFuehrungsstelleVerwalten />
    );
    const client = neuerQueryClient();
    // Der Testclient löscht inaktive Queries sonst sofort (gcTime: 0), während
    // die App ihren Cache beim Seitenwechsel behält.
    client.setQueryDefaults(einsatzKeys.mitglieder(7), { gcTime: Infinity });
    const { rerender } = renderMitProviders(ansicht(7), { client });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    );
    await userEvent.type(stellenFeld(), 'Stelle 7{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await anfrage;
    try {
      rerender(ansicht(8));
      await userEvent.click(
        await screen.findByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
      );
      await userEvent.type(stellenFeld(), 'Eingabe 8');
      await userEvent.tab();
    } finally {
      freigeben();
    }
    await waitFor(() =>
      expect(client.getQueryData(einsatzKeys.mitglieder(7))).toEqual([
        mitglied({ fuehrungsstelle: 'Stelle 7' }),
      ]),
    );
    expect(client.getQueryData(einsatzKeys.mitglieder(8))).toEqual([mitglied()]);
    expect(stellenWert()).toBe('Eingabe 8');
  });

  it('LFH-461: ein offener Dialog wird beim Einsatzwechsel geschlossen', async () => {
    server.use(
      http.get('/api/einsaetze/:id/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    const ansicht = (id: number) => (
      <ConfigProvider theme={{ token: { motion: false } }}>
        <MitgliederAbschnitt einsatzId={id} darfVerwalten darfFuehrungsstelleVerwalten />
      </ConfigProvider>
    );
    const { rerender } = renderMitProviders(ansicht(7));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    );
    await userEvent.type(stellenFeld(), 'Stelle in Einsatz 7{Enter}');
    rerender(ansicht(8));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('LFH-964: der umbrechende Führungsstellen-Knopf hält die Steuerhöhe der Dichte-Staffel', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <ConfigProvider theme={{ token: { controlHeight: 61 } }}>
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />
      </ConfigProvider>,
    );
    const knopf = await screen.findByRole('button', {
      name: 'Führungsstelle für Eva Einsatz bearbeiten',
    });
    // `height: auto` lässt den Knopf umbrechen; ohne Boden fiele er auf die Zeilenhöhe.
    expect(knopf).toHaveStyle({ height: 'auto', minHeight: '61px' });
  });

  it('LFH-461: Leitung pflegt und leert die Führungsstelle über die Mitglieder-API', async () => {
    let stelle: string | null = null;
    const gespeichert: unknown[] = [];
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () =>
        HttpResponse.json([mitglied({ fuehrungsstelle: stelle })]),
      ),
      http.get('/api/benutzer', () => HttpResponse.json([])),
      http.put('/api/einsaetze/7/mitglieder/2', async ({ request }) => {
        const body = (await request.json()) as { fuehrungsstelle: string | null };
        gespeichert.push(body);
        stelle = body.fuehrungsstelle;
        return HttpResponse.json([mitglied({ fuehrungsstelle: stelle })]);
      }),
    );
    // jsdom liefert kein animationend für den Modal-Abbau.
    renderMitProviders(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />
      </ConfigProvider>,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    );
    // Ohne Enter: der getippte Freitext wird beim Verlassen des Feldes übernommen, der Klick auf
    // „Speichern“ verliert ihn nicht.
    await userEvent.type(stellenFeld(), 'Florian Leitung');
    // Native Formularübermittlung statt eines Modal-Fußknopfs.
    const speichern = screen.getByRole('button', { name: 'Speichern' });
    expect(speichern.closest('form')).not.toBeNull();
    expect(speichern).toHaveAttribute('type', 'submit');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(gespeichert).toEqual([
      {
        einsatz_rolle: 'fuehrungspersonal',
        fuehrungsfunktion: null,
        fuehrungsstelle: 'Florian Leitung',
      },
    ]);
    expect(screen.getByText('Florian Leitung')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    );
    await userEvent.type(stellenFeld(), '{Backspace}');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(gespeichert).toHaveLength(2));
    expect(gespeichert[1]).toEqual({
      einsatz_rolle: 'fuehrungspersonal',
      fuehrungsfunktion: null,
      fuehrungsstelle: null,
    });
  });

  it('LFH-461: ohne Verwaltungsrecht ist die Führungsstelle nur lesbar', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () =>
        HttpResponse.json([mitglied({ fuehrungsstelle: 'Florian Leitung' })]),
      ),
    );
    renderMitProviders(
      <MitgliederAbschnitt
        einsatzId={7}
        darfVerwalten={false}
        darfFuehrungsstelleVerwalten={false}
      />,
    );
    expect(await screen.findByText('Florian Leitung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Führungsstelle/ })).not.toBeInTheDocument();
  });

  it('LFH-461: fehlgeschlagenes Speichern hält Eingabe und Fehler im Dialog', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
      http.put('/api/einsaetze/7/mitglieder/2', () =>
        HttpResponse.json({ error: 'Einsatz abgeschlossen' }, { status: 409 }),
      ),
    );
    renderMitProviders(
      <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    );
    await userEvent.type(stellenFeld(), 'Florian Leitung{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Einsatz abgeschlossen');
    expect(stellenWert()).toBe('Florian Leitung');
  });

  it('LFH-549: setzt S2 als Katalogwert und zeigt das Label', async () => {
    let zeile = mitglied();
    const gespeichert: unknown[] = [];
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([zeile])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
      http.put('/api/einsaetze/7/mitglieder/2', async ({ request }) => {
        gespeichert.push(await request.json());
        zeile = mitglied({ fuehrungsfunktion: 's2', fuehrungsstelle_anzeige: 'S2 Lage' });
        return HttpResponse.json([zeile]);
      }),
    );
    renderMitProviders(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />
      </ConfigProvider>,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    );
    // Der Vorrang vor der Ableitung steht an der Maske (Stab-Spec, Entscheidung 13), kurz und
    // ohne „Leer lassen …“ (LFH-1078). Ein neuer ETB-Eintrag wird nicht vorbelegt (LFH-894): die
    // Stelle ist nur der erste Vorschlag der Rufname-Abfrage.
    expect(
      screen.getByText('Erster Vorschlag für den ETB-Rufnamen, vor dem eigenen Sachgebiet'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Leer lassen|als Empfänger vorbelegt/)).not.toBeInTheDocument();
    await userEvent.click(stellenFeld());
    await userEvent.click(await screen.findByTitle('S2 – Lage (Müller)'));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(gespeichert).toEqual([
      { einsatz_rolle: 'fuehrungspersonal', fuehrungsfunktion: 's2', fuehrungsstelle: null },
    ]);
    expect(
      screen.getByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    ).toHaveTextContent('S2 Lage');
  });

  it('zeigt vorhandene Mitglieder', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
    );
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
  });

  it('zählt im Kopf „1 Mitglied“ in der Einzahl und ab zwei in der Mehrzahl', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    const { unmount } = renderMitProviders(
      <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
    );
    expect(await screen.findByText(/^1 Mitglied\s*$/)).toBeInTheDocument();
    unmount();

    server.use(
      http.get('/api/einsaetze/7/mitglieder', () =>
        HttpResponse.json([
          mitglied(),
          mitglied({ benutzer_id: 3, anzeigename: 'Udo Unter', benutzername: 'udo' }),
        ]),
      ),
    );
    renderMitProviders(
      <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
    );
    expect(await screen.findByText(/^2 Mitglieder\s*$/)).toBeInTheDocument();
  });

  it('entfernt ein Mitglied', async () => {
    let entfernt = false;
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () =>
        HttpResponse.json(entfernt ? [] : [mitglied()]),
      ),
      http.get('/api/benutzer', () => HttpResponse.json([])),
      http.delete('/api/einsaetze/7/mitglieder/2', () => {
        entfernt = true;
        return HttpResponse.json([]);
      }),
    );
    renderMitProviders(
      <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const popup = await screen.findByRole('tooltip');
    // Der Knopf nennt die Handlung, nicht „Ja“.
    await userEvent.click(within(popup).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(screen.queryByText('Eva Einsatz')).not.toBeInTheDocument());
  });

  it('beschriftet die Aktionsspalte und trägt einen echten Knopf statt eines Textlinks', async () => {
    /**
     * Die Aktionsspalte ist beschriftet (eine namenlose Spalte ist für einen Screenreader eine
     * Zelle ohne Zugehörigkeit), und der Knopf ist kein Textlink, weil er die einzige destruktive
     * Handlung der Zeile auslöst.
     */
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
    );
    // Erst auf die Datenzeile warten: die Kopfzeile steht auch ohne Mitglieder im Baum,
    // `findByRole('columnheader')` allein wäre grün, bevor es etwas zu bedienen gibt.
    await screen.findByText('Eva Einsatz');
    expect(screen.getByRole('columnheader', { name: 'Aktion' })).toBeInTheDocument();
    const knopf = screen.getByRole('button', { name: 'Entfernen' });
    expect(knopf.className).not.toMatch(/ant-btn-link\b/);
    // `danger` bleibt: Löschen ist Gefahr. Rot bedient nichts — aber es warnt.
    expect(knopf.className).toMatch(/ant-btn-color-dangerous|ant-btn-dangerous/);
  });

  it('blendet Edit-Aktionen aus, wenn nicht verwaltet werden darf', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <MitgliederAbschnitt
        einsatzId={7}
        darfVerwalten={false}
        darfFuehrungsstelleVerwalten={false}
      />,
    );
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });

  describe('LFH-966: Fehler im Paneel, letzte Einsatzleitung, eigene Herabstufung', () => {
    const leitung = (id: number, name: string) =>
      mitglied({
        benutzer_id: id,
        anzeigename: name,
        benutzername: name.toLowerCase(),
        einsatz_rolle: 'einsatzleitung',
      });
    const keinToast = () =>
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    const zeile = async (name: string) =>
      (await screen.findByText(name)).closest('tr') as HTMLElement;
    /** Öffnet das Rollenfeld einer Zeile und liefert die Option `name` der offenen Liste. */
    /** Die Rückfrage; über den Titel, weil antd im Test `aria-labelledby="test-id"` mehrfach vergibt. */
    const rueckfrage = async () =>
      (await screen.findByText('Eigene Rolle herabstufen?')).closest(
        '[role="dialog"]',
      ) as HTMLElement;
    async function rollenOption(name: string, option: string): Promise<HTMLElement> {
      await userEvent.click(screen.getByRole('combobox', { name: `Rolle von ${name}` }));
      const treffer = await screen.findAllByTitle(option);
      const sichtbar = treffer.filter((el) => el.closest('.ant-select-item-option'));
      return sichtbar[sichtbar.length - 1].closest('.ant-select-item-option') as HTMLElement;
    }

    it('ein abgelehntes Entfernen steht im Paneel, ohne Toast', async () => {
      server.use(
        meHandler(benutzerFixture({ id: 9, system_rolle: 'admin' })),
        http.get('/api/einsaetze/7/mitglieder', () =>
          HttpResponse.json([leitung(1, 'Lea'), mitglied()]),
        ),
        http.get('/api/benutzer', () => HttpResponse.json([])),
        http.delete('/api/einsaetze/7/mitglieder/2', () =>
          HttpResponse.json({ error: 'Entfernen abgelehnt' }, { status: 409 }),
        ),
      );
      renderMitProviders(
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
      );
      await userEvent.click(
        within(await zeile('Eva Einsatz')).getByRole('button', { name: 'Entfernen' }),
      );
      await userEvent.click(
        within(await screen.findByRole('tooltip')).getByRole('button', { name: 'Entfernen' }),
      );
      const hinweis = await screen.findByText('Entfernen abgelehnt');
      expect(hinweis.closest('[data-fehler]')).not.toBeNull();
      keinToast();
    });

    it('eine abgelehnte Rolle steht im Paneel, bis zum nächsten Absenden', async () => {
      let versuch = 0;
      server.use(
        meHandler(benutzerFixture({ id: 9, system_rolle: 'admin' })),
        http.get('/api/einsaetze/7/mitglieder', () =>
          HttpResponse.json([leitung(1, 'Lea'), mitglied()]),
        ),
        http.get('/api/benutzer', () => HttpResponse.json([])),
        http.put('/api/einsaetze/7/mitglieder/2', () => {
          versuch += 1;
          return versuch === 1
            ? HttpResponse.json({ error: 'Rolle abgelehnt' }, { status: 409 })
            : new Promise<never>(() => {});
        }),
      );
      renderMitProviders(
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
      );
      await zeile('Eva Einsatz');
      await userEvent.click(await rollenOption('Eva Einsatz', 'Beobachter'));
      expect(await screen.findByText('Rolle abgelehnt')).toBeInTheDocument();
      keinToast();
      await userEvent.click(await rollenOption('Eva Einsatz', 'Einsatzleitung'));
      await waitFor(() => expect(screen.queryByText('Rolle abgelehnt')).toBeNull());
    });

    it('sperrt an der einzigen Einsatzleitung Entfernen und Herabstufen, mit Grund', async () => {
      server.use(
        meHandler(benutzerFixture({ id: 9, system_rolle: 'admin' })),
        http.get('/api/einsaetze/7/mitglieder', () =>
          HttpResponse.json([leitung(1, 'Lea'), mitglied()]),
        ),
        http.get('/api/benutzer', () => HttpResponse.json([])),
      );
      renderMitProviders(
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
      );
      const lea = await zeile('Lea');
      const knopf = within(lea).getByRole('button', { name: 'Entfernen' });
      expect(knopf).toBeDisabled();
      const grund = within(lea).getByText(LETZTE_EINSATZLEITUNG_TEXT);
      expect(knopf).toHaveAttribute('aria-describedby', grund.id);
      expect(await rollenOption('Lea', 'Beobachter')).toHaveClass(
        'ant-select-item-option-disabled',
      );
      // Das andere Mitglied bleibt frei.
      const eva = await zeile('Eva Einsatz');
      expect(within(eva).getByRole('button', { name: 'Entfernen' })).toBeEnabled();
      expect(within(eva).queryByText(LETZTE_EINSATZLEITUNG_TEXT)).toBeNull();
    });

    it('mit zwei Einsatzleitungen ist keine gesperrt', async () => {
      server.use(
        meHandler(benutzerFixture({ id: 9, system_rolle: 'admin' })),
        http.get('/api/einsaetze/7/mitglieder', () =>
          HttpResponse.json([leitung(1, 'Lea'), leitung(3, 'Leo')]),
        ),
        http.get('/api/benutzer', () => HttpResponse.json([])),
      );
      renderMitProviders(
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
      );
      await zeile('Lea');
      for (const b of screen.getAllByRole('button', { name: 'Entfernen' })) expect(b).toBeEnabled();
      expect(screen.queryByText(LETZTE_EINSATZLEITUNG_TEXT)).toBeNull();
    });

    it('die eigene Herabstufung fragt nach; ohne Bestätigung wird nichts gespeichert', async () => {
      const gesendet: unknown[] = [];
      server.use(
        // Keine Systemrolle: ohne Leitung bliebe kein eigener Rückweg (LFH-343).
        meHandler(benutzerFixture({ id: 1, anzeigename: 'Lea' })),
        http.get('/api/einsaetze/7/mitglieder', () =>
          HttpResponse.json([leitung(1, 'Lea'), leitung(3, 'Leo')]),
        ),
        http.get('/api/benutzer', () => HttpResponse.json([])),
        http.put('/api/einsaetze/7/mitglieder/1', async ({ request }) => {
          gesendet.push(await request.json());
          return HttpResponse.json([
            mitglied({ benutzer_id: 1, anzeigename: 'Lea', einsatz_rolle: 'beobachter' }),
            leitung(3, 'Leo'),
          ]);
        }),
      );
      renderMitProviders(
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
      );
      await zeile('Lea');
      await userEvent.click(await rollenOption('Lea', 'Beobachter'));
      const frage = await rueckfrage();
      await userEvent.click(within(frage).getByRole('button', { name: 'Abbrechen' }));
      await waitFor(() => expect(screen.queryByText('Eigene Rolle herabstufen?')).toBeNull());
      expect(gesendet).toHaveLength(0);

      await userEvent.click(await rollenOption('Lea', 'Beobachter'));
      const zweite = await rueckfrage();
      await userEvent.click(within(zweite).getByRole('button', { name: 'Rolle herabstufen' }));
      await waitFor(() =>
        expect(gesendet).toEqual([expect.objectContaining({ einsatz_rolle: 'beobachter' })]),
      );
    });

    it('fremde Zeilen und das Hochstufen fragen nicht nach', async () => {
      const gesendet: string[] = [];
      server.use(
        meHandler(benutzerFixture({ id: 1, anzeigename: 'Lea' })),
        http.get('/api/einsaetze/7/mitglieder', () =>
          HttpResponse.json([leitung(1, 'Lea'), leitung(3, 'Leo')]),
        ),
        http.get('/api/benutzer', () => HttpResponse.json([])),
        http.put('/api/einsaetze/7/mitglieder/:id', ({ params }) => {
          gesendet.push(String(params.id));
          return new Promise<never>(() => {});
        }),
      );
      renderMitProviders(
        <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
      );
      await zeile('Leo');
      await userEvent.click(await rollenOption('Leo', 'Beobachter'));
      await waitFor(() => expect(gesendet).toEqual(['3']));
      expect(screen.queryByText('Eigene Rolle herabstufen?')).toBeNull();
    });

    it('ohne Verwaltungsrecht: keine Sperrtexte, kein Entfernen', async () => {
      server.use(
        http.get('/api/einsaetze/7/mitglieder', () =>
          HttpResponse.json([leitung(1, 'Lea'), mitglied()]),
        ),
      );
      renderMitProviders(
        <MitgliederAbschnitt
          einsatzId={7}
          darfVerwalten={false}
          darfFuehrungsstelleVerwalten={false}
        />,
      );
      await zeile('Lea');
      expect(screen.queryByText(LETZTE_EINSATZLEITUNG_TEXT)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull();
    });
  });
});
