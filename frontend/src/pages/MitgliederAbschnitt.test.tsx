import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConfigProvider } from 'antd';
import { server } from '../test/server';
import { einsatzKeys } from '../api/queryKeys';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import MitgliederAbschnitt from './MitgliederAbschnitt';

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
    const feld = screen.getByRole('textbox', { name: 'Führungsstelle' });
    await waitFor(() => expect(feld).toHaveFocus());
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Verworfene Eingabe');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(ausloeser);
    expect(screen.getByRole('textbox', { name: 'Führungsstelle' })).toHaveValue(
      'Gespeicherte Stelle',
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Führungsstelle' })).toHaveFocus(),
    );
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
    await userEvent.type(screen.getByRole('textbox', { name: 'Führungsstelle' }), 'Stelle 7');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await anfrage;
    try {
      rerender(ansicht(8));
      await userEvent.click(
        await screen.findByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
      );
      await userEvent.type(screen.getByRole('textbox', { name: 'Führungsstelle' }), 'Eingabe 8');
    } finally {
      freigeben();
    }
    await waitFor(() =>
      expect(client.getQueryData(einsatzKeys.mitglieder(7))).toEqual([
        mitglied({ fuehrungsstelle: 'Stelle 7' }),
      ]),
    );
    expect(client.getQueryData(einsatzKeys.mitglieder(8))).toEqual([mitglied()]);
    expect(screen.getByRole('textbox', { name: 'Führungsstelle' })).toHaveValue('Eingabe 8');
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
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Führungsstelle' }),
      'Stelle in Einsatz 7',
    );
    rerender(ansicht(8));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Führungsstelle' }),
      'Florian Leitung',
    );
    // LFH-461 Review: native Formularübermittlung statt eines Modal-Fußknopfs.
    const speichern = screen.getByRole('button', { name: 'Speichern' });
    expect(speichern.closest('form')).not.toBeNull();
    expect(speichern).toHaveAttribute('type', 'submit');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(gespeichert).toEqual([
      { einsatz_rolle: 'fuehrungspersonal', fuehrungsstelle: 'Florian Leitung' },
    ]);
    expect(screen.getByText('Florian Leitung')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    );
    await userEvent.clear(screen.getByRole('textbox', { name: 'Führungsstelle' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(gespeichert).toHaveLength(2));
    expect(gespeichert[1]).toEqual({ einsatz_rolle: 'fuehrungspersonal', fuehrungsstelle: null });
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
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Führungsstelle' }),
      'Florian Leitung',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Einsatz abgeschlossen');
    expect(screen.getByRole('textbox', { name: 'Führungsstelle' })).toHaveValue('Florian Leitung');
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
    await userEvent.click(within(popup).getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(screen.queryByText('Eva Einsatz')).not.toBeInTheDocument());
  });

  it('beschriftet die Aktionsspalte und trägt einen echten Knopf statt eines Textlinks', async () => {
    /**
     * Befund N7 (LFH-339 · C4). Die Aktionsspalte hiess `title: ''` — eine namenlose
     * Spalte ist für einen Screenreader eine Zelle ohne Zugehörigkeit, und ein
     * `Button type="link"` sieht aus wie Fliesstext, obwohl er die einzige destruktive
     * Handlung der Zeile auslöst.
     */
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <MitgliederAbschnitt einsatzId={7} darfVerwalten darfFuehrungsstelleVerwalten />,
    );
    // Erst auf die DATENZEILE warten: die Kopfzeile steht auch ohne Mitglieder im Baum,
    // ein `findByRole('columnheader')` allein wäre also grün, bevor es etwas zu bedienen
    // gibt — und der Knopf darunter dann noch nicht da.
    await screen.findByText('Eva Einsatz');
    expect(screen.getByRole('columnheader', { name: 'Aktion' })).toBeInTheDocument();
    const knopf = screen.getByRole('button', { name: 'Entfernen' });
    expect(knopf.className).not.toMatch(/ant-btn-link\b/);
    // `danger` bleibt: Löschen IST Gefahr. Rot bedient nichts — aber es warnt.
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
});
