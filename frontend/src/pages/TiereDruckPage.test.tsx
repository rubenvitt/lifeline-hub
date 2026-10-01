import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import type { Tier } from '../api/types';
import TiereDruckPage from './TiereDruckPage';

/** Tiere-Druckansicht (LFH-727, design.md D4/D5): Auswahl aus der Adresse, Schnappschuss. */

const EINSATZ = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0007',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
};

function tier(nr: number, over: Partial<Tier> = {}): Tier {
  return {
    id: nr * 10,
    einsatz_id: 7,
    registrier_nr: nr,
    status: 'aktiv',
    spezies: 'hund',
    rasse_beschreibung: null,
    rufname: `Tier ${nr}`,
    geschlecht: null,
    alter_geschaetzt: null,
    farbe_beschreibung: null,
    kennzeichnung: null,
    groesse_gewicht: null,
    halter_person_id: null,
    halter_kontakt: null,
    antreff_ort: null,
    notiz: null,
    abschluss_grund: null,
    abschluss_ziel: null,
    erfasst_at: '2026-09-25 06:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-09-25 06:00:00',
    geaendert_von: 1,
    storniert_at: null,
    halter_registrier_nr: null,
    halter_storniert_at: null,
    ...over,
  };
}

const BESTAND = [
  tier(1, { status: 'aktiv', spezies: 'hund' }),
  tier(2, { status: 'vermisst', spezies: 'katze' }),
  tier(3, { status: 'vermisst', spezies: 'hund' }),
  tier(4, { status: 'abgeschlossen', spezies: 'hund' }),
];

function rendere(suche = '', client = neuerQueryClient()) {
  const abrufe = { liste: 0, parameter: [] as string[] };
  server.use(
    http.get('/api/einsaetze/7', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/7/tiere', ({ request }) => {
      abrufe.liste += 1;
      abrufe.parameter.push(new URL(request.url).search);
      return HttpResponse.json(BESTAND);
    }),
  );
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/tiere/druck" element={<TiereDruckPage />} />
    </Routes>,
    { route: `/einsaetze/7/tiere/druck${suche}`, client },
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
    document.querySelectorAll('[data-lfh="tiere-druck-tabelle"] tbody tr td:first-child'),
  ).map((td) => td.textContent ?? '');
}
const kopf = () => document.querySelector<HTMLElement>('[data-lfh="druckkopf"]')!;

describe('TiereDruckPage', () => {
  it('lädt die ganze Liste ohne Serverfilter und wählt nach der Adresse aus', async () => {
    const abrufe = rendere('?sicht=vermisst&spezies=hund');
    await fertig();
    expect(abrufe.parameter).toEqual(['']);
    expect(nummern()).toEqual(['T-003']);
    expect(kopf()).toHaveTextContent('Tierliste');
    expect(kopf()).toHaveTextContent('Sicht: Vermisst · Spezies: Hund');
    expect(kopf()).toHaveTextContent('1 Tier');
  });

  it('druckt ohne Sicht in der Adresse alle Tiere, nicht nur die aktiven', async () => {
    rendere();
    await fertig();
    expect(nummern()).toEqual(['T-001', 'T-002', 'T-003', 'T-004']);
    expect(kopf()).toHaveTextContent('alle Tiere');
  });

  it('ist ein Schnappschuss: das Live-Ereignis der Tierliste lädt nicht nach', async () => {
    const client = neuerQueryClient();
    const abrufe = rendere('', client);
    await fertig();
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.tiere(7) }));
    await new Promise((r) => setTimeout(r, 50));
    expect(abrufe.liste).toBe(1);
  });
});
