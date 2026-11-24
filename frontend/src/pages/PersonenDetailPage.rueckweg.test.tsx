import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, Outlet, Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PersonenDetailPage from './PersonenDetailPage';
import type { PersonDetail } from '../api/types';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import { VerlaufMerken } from '../routing/VerlaufMerken';
import { verlaufGedaechtnisRaeumen } from '../routing/verlaufGedaechtnis';

/** Rückweg über den Ortspfad (LLH-1997): von der gefilterten Liste zurück auf dieselbe Liste. */

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  verlaufGedaechtnisRaeumen();
});
afterEach(() => vi.unstubAllGlobals());

const detail = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  versorgung: 'offen',
  aktuelle_sichtung: null,
  aktuelle_sichtung_at: null,
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
  sichtungen: [],
  notizen: [],
  verbleib: [],
  abgleiche: [],
  transporte: [],
  massnahmen: [],
  verletzungen: [],
  anlaesse: [],
} as PersonDetail;

function Liste() {
  const { search } = useLocation();
  return (
    <div>
      <output data-testid="liste">{`LISTE${search}`}</output>
      <Link to="/einsaetze/1/personen/10">Max öffnen</Link>
    </div>
  );
}

function render(route: string) {
  server.use(
    meHandler(benutzerFixture()),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzFixture())),
    http.get('/api/einsaetze/1/persons/10', () => HttpResponse.json(detail)),
    http.get('/api/einsaetze/1/animals', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/damages', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/persons/transport-means', () =>
      HttpResponse.json({ im_einsatz: [], bisher: [], stamm: [] }),
    ),
    http.get('/api/einsaetze/1/persons/10/audit', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route
        element={
          <>
            <VerlaufMerken />
            <Outlet />
          </>
        }
      >
        <Route path="/einsaetze/:id/personen" element={<Liste />} />
        <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
      </Route>
    </Routes>,
    { route, datenRouter: true },
  );
}

const ortspfadZurListe = async () =>
  within(await screen.findByRole('navigation')).getByRole('link', { name: 'Betroffene' });

describe('PersonenDetailPage — Rückweg über den Ortspfad (LLH-1997)', () => {
  it('führt auf die Liste mit ihrem Filter zurück, wenn man von dort kam', async () => {
    const user = userEvent.setup();
    render('/einsaetze/1/personen?q=meier');
    await user.click(await screen.findByRole('link', { name: 'Max öffnen' }));
    await user.click(await ortspfadZurListe());
    expect(await screen.findByTestId('liste')).toHaveTextContent('LISTE?q=meier');
  });

  it('führt direkt geöffnet auf die Liste mit ihrer Vorgabe', async () => {
    const user = userEvent.setup();
    render('/einsaetze/1/personen/10');
    await user.click(await ortspfadZurListe());
    expect(await screen.findByTestId('liste')).toHaveTextContent(/^LISTE$/);
  });
});
