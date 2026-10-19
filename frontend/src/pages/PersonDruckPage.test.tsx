import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { EINSATZ_KEYS } from '../api/queryKeys';
import type { PersonDetail } from '../api/types';
import PersonDruckPage from './PersonDruckPage';

/**
 * Druckansicht einer Person (LLH-1120, Spec `druck-dokumente`, „Druckansicht einer Person“):
 * einmal laden, „Neu laden“, Druck nur mit Person, unbekannte Person als solche, schwarz-weiß.
 */

const EINSATZ = {
  id: 5,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0005',
  status: 'aktiv',
  meine_rolle: 'beobachter',
};

function person(teil: Partial<PersonDetail> = {}): PersonDetail {
  return {
    id: 10,
    einsatz_id: 5,
    registrier_nr: 12,
    status: 'betroffen',
    name: 'Mustermann',
    vorname: 'Max',
    geschlecht: 'maennlich',
    geburtsdatum: null,
    alter_geschaetzt: 45,
    herkunft_adresse: null,
    antreff_ort: 'Brücke',
    melder_kontakt: null,
    notiz: null,
    zustand: 'Verdacht auf Hüftfraktur',
    erfasst_at: '2026-10-18 08:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-10-18 08:00:00',
    geaendert_von: 1,
    storniert_at: null,
    aktuelle_sichtung: 'sk2',
    aktuelle_sichtung_at: '2026-10-18 09:18:00',
    aktueller_verbleib: null,
    aktuelle_uhs_id: null,
    aktueller_platz_id: null,
    pat_nummer: 'A-4711',
    kontamination: true,
    transport_prioritaet: 'dringlich',
    transport_art: 'liegend',
    transport_fachrichtung: 'unfallchirurgie',
    transport_at: '2026-10-18 09:50:00',
    sichtungen: [],
    notizen: [],
    verbleib: [],
    abgleiche: [],
    transporte: [],
    massnahmen: [
      {
        id: 1,
        einsatz_id: 5,
        person_id: 10,
        art: 'blutstillung',
        zeitpunkt_at: '2026-10-18 09:30:00',
        erfasst_at: '2026-10-18 09:30:00',
        erfasst_von: 1,
      },
    ],
    verletzungen: [1, 2, 3].map((id) => ({
      id,
      einsatz_id: 5,
      person_id: 10,
      ansicht: 'vorn' as const,
      region: (['kopf', 'thorax', 'unterarm_l'] as const)[id - 1],
      art: 'wunde_blutung' as const,
      zeitpunkt_at: '2026-10-18 09:40:00',
      erfasst_at: '2026-10-18 09:40:00',
      erfasst_von: 1,
    })),
    ...teil,
  } as PersonDetail;
}

function renderPage(antwort: () => Response | Promise<Response>, client = neuerQueryClient()) {
  const abrufe = { druck: 0, detail: 0 };
  server.use(
    http.get('/api/einsaetze/5', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/5/personen/10', () => {
      abrufe.detail += 1;
      return HttpResponse.json(person());
    }),
    http.get('/api/einsaetze/5/personen/10/druck', () => {
      abrufe.druck += 1;
      return antwort();
    }),
  );
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personen/:personId/druck" element={<PersonDruckPage />} />
      <Route path="/einsaetze/:id/personen/:personId" element={<div>Detail</div>} />
    </Routes>,
    { route: '/einsaetze/5/personen/10/druck', client },
  );
  return abrufe;
}

const druckKnopf = () => screen.getByRole('button', { name: 'Drucken / als PDF' });
async function fertig() {
  await waitFor(() => expect(druckKnopf()).toBeEnabled());
}
const wurzel = () => document.querySelector<HTMLElement>('[data-lfh="druckwurzel"]')!;

describe('PersonDruckPage', () => {
  it('lädt über den Druck-Endpunkt der Person, nie über das Detail, und genau einmal', async () => {
    const abrufe = renderPage(() => HttpResponse.json(person()));
    await fertig();
    expect(abrufe).toEqual({ druck: 1, detail: 0 });
    expect(document.querySelectorAll('[data-lfh="druckwurzel"]')).toHaveLength(1);
  });

  it('trägt Personendaten, Sichtung, Zustand, Transport, PAT, Kontamination und Maßnahmen', async () => {
    renderPage(() => HttpResponse.json(person()));
    await fertig();
    const blatt = within(wurzel());
    expect(wurzel().querySelector('[data-lfh="druckkopf"]')).toHaveTextContent('R-012');
    for (const [etikett, wert] of [
      ['Name', 'Mustermann'],
      // Das Wort der Oberfläche, nie der Wire-Wert „maennlich“.
      ['Geschlecht', /^männlich$/],
      ['Sichtung', /^SK II · schwer · \d{6}/],
      ['Zustand / Verdacht', 'Verdacht auf Hüftfraktur'],
      ['Transport', /^dringlich · liegend · Unfallchirurgie/],
      ['PAT-Nummer', 'A-4711'],
      ['Kontamination', 'kontaminiert'],
      ['Blutstillung', /^\d{6}/],
    ] as const) {
      const dt = blatt.getByText(etikett, { selector: 'dt' });
      expect(dt.nextElementSibling?.textContent ?? '').toMatch(wert);
    }
  });

  it('zeigt das Körperschema schwarz-weiß: Figur ohne Fläche, Sternchen 1 bis 3 wie die Liste', async () => {
    renderPage(() => HttpResponse.json(person()));
    await fertig();
    const schema = within(wurzel()).getByRole('region', { name: 'Körperschema' });
    const figuren = schema.querySelectorAll('[data-lfh="koerperfigur"]');
    expect(figuren).toHaveLength(2);
    for (const f of figuren) {
      const umriss = f.querySelector('path');
      expect(umriss?.getAttribute('fill')).toBe('none');
      expect(umriss?.getAttribute('stroke')).toBe('currentColor');
    }
    expect(
      [...schema.querySelectorAll('[data-lfh="stern"]')].map((s) => s.getAttribute('data-nummer')),
    ).toEqual(['1', '2', '3']);
    expect(
      within(schema)
        .getAllByRole('listitem')
        .map((li) => li.textContent?.split(' ')[0]),
    ).toEqual(['1', '2', '3']);
    expect(within(schema).queryAllByRole('button')).toHaveLength(0);
  });

  it('ist ein Schnappschuss: ein Abgleich des Details ändert das Blatt nicht, „Neu laden“ schon', async () => {
    const client = neuerQueryClient();
    let stand = person();
    const abrufe = renderPage(() => HttpResponse.json(stand), client);
    await fertig();
    stand = person({ zustand: 'stabil' });
    await act(() => client.invalidateQueries({ queryKey: [EINSATZ_KEYS.person] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(abrufe.druck).toBe(1);
    expect(screen.getByText('Verdacht auf Hüftfraktur')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(screen.getByText('stabil')).toBeInTheDocument());
    expect(abrufe.druck).toBe(2);
  });

  it('unbekannte Person: „nicht gefunden“, kein Druck', async () => {
    renderPage(() => HttpResponse.json({ error: 'Person nicht gefunden' }, { status: 404 }));
    expect(await screen.findByText('Person nicht gefunden')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Neu laden' })).toBeNull();
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toBeNull();
  });
});
