import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { sichtbareFormfelder } from '../test/feldbudget';
import { waehle } from '../test/auswahlListe';
import type { MitgliedAuswahl } from '../api/types';
import EinsaetzePage from './EinsaetzePage';
import { adminFixture } from '../test/fixtures';
import { mitgliederKopf } from './MitgliederKlappteil';

/**
 * Teil „Mitglieder“ im Anlegedialog (LLH-1820, Design-Doc
 * `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`,
 * „Dialog“): eingeklappt unter den sechs Feldern, der Kopf nennt die Wahl, die Auswahl lädt erst
 * beim Aufklappen, gewählte Personen kommen mit ihrer Rolle in den Anlege-Rumpf.
 */

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests.
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: () => <div data-testid="kartenausschnitt" />,
}));

const admin = adminFixture();

const AUSWAHL: MitgliedAuswahl[] = [
  { benutzer_id: 7, anzeigename: 'Anna Beispiel' },
  { benutzer_id: 8, anzeigename: 'Bernd Muster' },
];

/** Rendert die Seite samt Ziel, zählt die Auswahl-Abrufe und zeichnet den Anlege-Rumpf auf. */
function setup(antwort?: () => Response) {
  const stand = { rumpf: null as Record<string, unknown> | null, auswahlAbrufe: 0 };
  server.use(
    meHandler(admin),
    http.get('/api/incidents', () => HttpResponse.json([])),
    http.get('/api/incidents/member-selection', () => {
      stand.auswahlAbrufe += 1;
      return HttpResponse.json(AUSWAHL);
    }),
    http.post('/api/incidents', async ({ request }) => {
      stand.rumpf = (await request.json()) as Record<string, unknown>;
      if (antwort) return antwort();
      return HttpResponse.json(
        {
          id: 7,
          bezeichnung: 'Unfall A2',
          status: 'aktiv',
          begonnen_at: '2026-05-23 09:00:00',
          meine_rolle: 'einsatzleitung',
        },
        { status: 201 },
      );
    }),
  );
  renderMitProviders(
    <Routes>
      <Route path="/" element={<EinsaetzePage />} />
      <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
    </Routes>,
  );
  return stand;
}

async function oeffneDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
  return screen.findByRole('dialog', { name: 'Neuen Einsatz anlegen' });
}

const klappkopf = () => screen.getByRole('button', { name: /^Mitglieder/ });

async function klappeAuf() {
  await userEvent.click(klappkopf());
  await screen.findByRole('combobox', { name: 'Personen' });
}

describe('mitgliederKopf', () => {
  it('nennt die Wahl: nur Einsatzleitung, eine Person, mehrere Personen', () => {
    expect(mitgliederKopf(0)).toBe('Mitglieder · nur Einsatzleitung');
    expect(mitgliederKopf(1)).toBe('Mitglieder · Einsatzleitung + 1 Person');
    expect(mitgliederKopf(3)).toBe('Mitglieder · Einsatzleitung + 3 Personen');
  });
});

describe('Anlegedialog · Mitglieder (LLH-1820)', () => {
  it('der Kopf nennt die Wahl', async () => {
    setup();
    await oeffneDialog();
    expect(klappkopf()).toHaveTextContent('nur Einsatzleitung');
    await klappeAuf();
    await waehle('Personen', 'Anna Beispiel', 'Bernd Muster');
    await waitFor(() => expect(klappkopf()).toHaveTextContent('Einsatzleitung + 2 Personen'));
  });

  it('eine neu gewählte Person steht auf „Führungspersonal“ und lässt sich umstellen', async () => {
    const stand = setup();
    await oeffneDialog();
    await klappeAuf();
    await waehle('Personen', 'Anna Beispiel');
    const rolle = await screen.findByRole('combobox', { name: 'Rolle von Anna Beispiel' });
    expect(rolle.closest('.ant-select')).toHaveTextContent('Führungspersonal');
    await waehle('Rolle von Anna Beispiel', 'Beobachter');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Unfall A2');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(stand.rumpf).not.toBeNull());
    expect(stand.rumpf!.mitglieder).toEqual([{ benutzer_id: 7, rolle: 'beobachter' }]);
  });

  it('zeigt die anlegende Person als feste Zeile „Eigene Rolle: Einsatzleitung“', async () => {
    setup();
    await oeffneDialog();
    await klappeAuf();
    expect(screen.getByText('Eigene Rolle: Einsatzleitung')).toBeInTheDocument();
  });

  it('lädt die Auswahl erst beim Aufklappen', async () => {
    const stand = setup();
    await oeffneDialog();
    // Vorlagen und Schichtmodelle laden beim Öffnen; die Personen noch nicht.
    await new Promise((r) => setTimeout(r, 50));
    expect(stand.auswahlAbrufe).toBe(0);
    await klappeAuf();
    await waitFor(() => expect(stand.auswahlAbrufe).toBe(1));
  });

  it('sendet die gewählten Mitglieder beim Anlegen mit', async () => {
    const stand = setup();
    await oeffneDialog();
    await klappeAuf();
    await waehle('Personen', 'Anna Beispiel');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Unfall A2');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(stand.rumpf).not.toBeNull());
    expect(stand.rumpf!.mitglieder).toEqual([{ benutzer_id: 7, rolle: 'fuehrungspersonal' }]);
    expect(await screen.findByText('Workspace-7')).toBeInTheDocument();
  });

  it('ohne Wahl schickt der Rumpf keine Mitglieder', async () => {
    const stand = setup();
    await oeffneDialog();
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Unfall A2');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(stand.rumpf).not.toBeNull());
    expect(stand.rumpf!).not.toHaveProperty('mitglieder');
  });

  it('Feldbudget: zugeklappt sechs sichtbare Felder, aufgeklappt mehr', async () => {
    setup();
    const dialog = await oeffneDialog();
    // Ohne Vorlagen fehlt das Feld „Vorlage“: fünf (frontend/AGENTS.md, Feldbudget).
    await waitFor(() => expect(sichtbareFormfelder(dialog).length).toBe(5));
    // Im Baum, nur nicht sichtbar (`forceRender`): die Zählung ist nicht aus Abwesenheit richtig.
    expect(within(dialog).getByRole('combobox', { name: 'Personen', hidden: true })).toBeTruthy();
    await klappeAuf();
    await waitFor(() => expect(sichtbareFormfelder(dialog).length).toBeGreaterThan(5));
  });

  it('eine Ablehnung des Servers steht in der Fehlerzeile des Dialogs', async () => {
    setup(() =>
      HttpResponse.json(
        { error: 'Mitglieder: Anna Beispiel kann nicht aufgenommen werden.' },
        { status: 400 },
      ),
    );
    const dialog = await oeffneDialog();
    await klappeAuf();
    await waehle('Personen', 'Anna Beispiel');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Unfall A2');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(
      await within(dialog).findByText(/Mitglieder: Anna Beispiel kann nicht aufgenommen werden\./),
    ).toBeInTheDocument();
    // Die Wahl bleibt im Kopf sichtbar, ohne aufzuklappen.
    expect(klappkopf()).toHaveTextContent('Einsatzleitung + 1 Person');
  });
});
