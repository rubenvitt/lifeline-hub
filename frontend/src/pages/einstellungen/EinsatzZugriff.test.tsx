import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import EinsatzEinstellungenPage from '../EinsatzEinstellungenPage';
import EinsatzZugriff from './EinsatzZugriff';

/** Sektion „Zugriff“ (LFH-1170, Spec `einsatz-zugriff`): das Paneel der Einsatzdaten, umgezogen. */

const einsatz = (meine_rolle: string | null, status = 'aktiv') => ({
  id: 1,
  bezeichnung: 'Hochwasser Weser',
  status,
  meine_rolle,
});

function setupServer(rolle: string | null, status = 'aktiv') {
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz(rolle, status))),
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, org_defaults: { org_id: 1 } }),
    ),
    http.get('/api/einsaetze/1/mitglieder', () =>
      HttpResponse.json([
        {
          benutzer_id: 2,
          anzeigename: 'Eva Einsatz',
          benutzername: 'eva',
          einsatz_rolle: 'fuehrungspersonal',
          zugewiesen_at: '2026-05-23 10:00:00',
        },
      ]),
    ),
    http.get('/api/einsaetze/1/mitglieder/auswahl', () =>
      HttpResponse.json([{ benutzer_id: 9, anzeigename: 'Paul Probe' }]),
    ),
  );
}

/** Zeigt die Adresse, damit der Test sieht, ob der Auftrag geräumt ist. */
function Adresse() {
  const { pathname, search } = useLocation();
  return <output data-testid="adresse">{pathname + search}</output>;
}

/** Layout samt Sektion: den Auftrag `neu` liest das Layout (LFH-1170, D7). */
function renderMitLayout(route: string) {
  return renderMitProviders(
    <>
      <Routes>
        <Route path="/einsaetze/:id/einstellungen" element={<EinsatzEinstellungenPage />}>
          <Route path="zugriff" element={<EinsatzZugriff />} />
        </Route>
      </Routes>
      <Adresse />
    </>,
    { route },
  );
}

function renderZugriff() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/zugriff" element={<EinsatzZugriff />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/zugriff' },
  );
}

describe('EinsatzZugriff', () => {
  it('Einsatzleitung: Mitglieder und die Zeile zum Aufnehmen, kein Rechtehinweis', async () => {
    setupServer('einsatzleitung');
    renderZugriff();
    const zugriff = await screen.findByRole('region', { name: 'Zugriff' });
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
    expect(zugriff).toContainElement(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(screen.queryByText('nur Einsatzleitung')).toBeNull();
  });

  it('Führungspersonal: Liste ohne Bedienziele, der Grund steht dabei', async () => {
    setupServer('fuehrungspersonal');
    renderZugriff();
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
    expect(screen.getByText('nur Einsatzleitung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Rolle von Eva Einsatz' })).toBeDisabled();
  });

  // LFH-461, umgezogen von den Einsatzdaten: `mitglied_setzen` fordert die Einsatzrolle, ohne
  // Ausnahme für System-Admins.
  it.each([null, 'beobachter', 'fuehrungspersonal'] as const)(
    'Rolle %s: keine Führungsstelle je Person bearbeitbar',
    async (rolle) => {
      setupServer(rolle);
      renderZugriff();
      expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /Führungsstelle für/ })).toHaveLength(0);
    },
  );

  it('aktive Einsatzleitung bearbeitet die Führungsstelle je Person', async () => {
    setupServer('einsatzleitung');
    renderZugriff();
    expect(
      await screen.findByRole('button', { name: 'Führungsstelle für Eva Einsatz bearbeiten' }),
    ).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz: kein zweiter Hinweis, den Grund trägt die Einstellungsseite', async () => {
    setupServer('einsatzleitung', 'abgeschlossen');
    renderZugriff();
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
    expect(screen.queryByText('nur Einsatzleitung')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).toBeNull();
  });

  describe('Schnellaktion „Mitglied aufnehmen“ (LFH-1170)', () => {
    it('öffnet mit `?neu=1` die Personenauswahl mit Fokus und räumt den Auftrag', async () => {
      setupServer('einsatzleitung');
      renderMitLayout('/einsaetze/1/einstellungen/zugriff?neu=1');
      const auswahl = await screen.findByRole('combobox', { name: 'Person zum Aufnehmen' });
      await waitFor(() => expect(auswahl).toHaveFocus());
      expect(auswahl).toHaveAttribute('aria-expanded', 'true');
      expect(await screen.findByRole('option', { name: 'Paul Probe' })).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByTestId('adresse')).toHaveTextContent(
          /^\/einsaetze\/1\/einstellungen\/zugriff$/,
        ),
      );
    });

    it('ohne Auftrag bleibt die Auswahl zu und ohne Fokus', async () => {
      setupServer('einsatzleitung');
      renderMitLayout('/einsaetze/1/einstellungen/zugriff');
      const auswahl = await screen.findByRole('combobox', { name: 'Person zum Aufnehmen' });
      expect(auswahl).not.toHaveFocus();
      expect(auswahl).toHaveAttribute('aria-expanded', 'false');
    });

    it('ohne Leitungsrecht bleibt der Auftrag folgenlos', async () => {
      setupServer('fuehrungspersonal');
      renderMitLayout('/einsaetze/1/einstellungen/zugriff?neu=1');
      expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Person zum Aufnehmen' })).toBeNull();
    });
  });
});
