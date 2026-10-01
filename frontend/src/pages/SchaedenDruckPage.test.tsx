import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import SchaedenDruckPage from './SchaedenDruckPage';

/** Schäden-Druckansicht (LFH-727, design.md D4/D5): Auswahl aus der Adresse, Schnappschuss. */

const EINSATZ = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0007',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
};

function schaden(nr: number, status: string) {
  return {
    id: nr * 10,
    einsatz_id: 7,
    registrier_nr: nr,
    status,
    typ: 'sachschaden',
    ausmass: 'gering',
    ort: `Ort ${nr}`,
    beschreibung: '',
    lat: null,
    lon: null,
    geschaedigt_person_id: null,
    geschaedigt_personal_id: null,
    geschaedigt_organisation_id: null,
    geschaedigt_kontakt: null,
    uebergeben_an: null,
    uebergeben_at: null,
    abschluss_grund: null,
    abschluss_at: null,
    erfasst_at: '2026-09-25 06:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-09-25 06:00:00',
    geaendert_von: 1,
    storniert_at: null,
    storniert_von: null,
    geschaedigt_registrier_nr: null,
    geschaedigt_storniert_at: null,
    geschaedigt_personal_name: null,
    geschaedigt_organisation_name: null,
  };
}

const BESTAND = [schaden(1, 'offen'), schaden(2, 'uebergeben'), schaden(3, 'offen')];

function rendere(suche = '', client = neuerQueryClient()) {
  const abrufe = { liste: 0, parameter: [] as string[] };
  server.use(
    http.get('/api/einsaetze/7', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/7/schaeden', ({ request }) => {
      abrufe.liste += 1;
      abrufe.parameter.push(new URL(request.url).search);
      return HttpResponse.json(BESTAND);
    }),
  );
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/schaeden/druck" element={<SchaedenDruckPage />} />
    </Routes>,
    { route: `/einsaetze/7/schaeden/druck${suche}`, client },
  );
  return abrufe;
}

async function fertig() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled(),
  );
}
function nummern(): string[] {
  return Array.from(
    document.querySelectorAll('[data-lfh="schaeden-druck-tabelle"] tbody tr td:first-child'),
  ).map((td) => td.textContent ?? '');
}
const kopf = () => document.querySelector<HTMLElement>('[data-lfh="druckkopf"]')!;

describe('SchaedenDruckPage', () => {
  it('lädt die ganze Liste ohne Serverfilter und wählt nach der Adresse aus', async () => {
    const abrufe = rendere('?sicht=offen');
    await fertig();
    expect(abrufe.parameter).toEqual(['']);
    expect(nummern()).toEqual(['S-001', 'S-003']);
    expect(kopf()).toHaveTextContent('Schadensliste');
    expect(kopf()).toHaveTextContent('Sicht: Offen');
    expect(kopf()).toHaveTextContent('2 Schäden');
  });

  it('druckt ohne Sicht in der Adresse alle Schäden', async () => {
    rendere();
    await fertig();
    expect(nummern()).toEqual(['S-001', 'S-002', 'S-003']);
    expect(kopf()).toHaveTextContent('alle Schäden');
  });

  it('ist ein Schnappschuss: das Live-Ereignis der Schadensliste lädt nicht nach', async () => {
    const client = neuerQueryClient();
    const abrufe = rendere('', client);
    await fertig();
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.schaeden(7) }));
    await new Promise((r) => setTimeout(r, 50));
    expect(abrufe.liste).toBe(1);
  });
});
