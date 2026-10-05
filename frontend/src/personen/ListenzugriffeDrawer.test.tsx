import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { erzeugeQueryClient } from '../api/queryClient';
import ListenzugriffeDrawer from './ListenzugriffeDrawer';
import type { PersonZugriff } from '../api/types';

const URL = '/api/einsaetze/1/personen/listenzugriffe';

const eintraege: PersonZugriff[] = [
  {
    id: 7,
    person_id: null,
    benutzer_id: 2,
    benutzer_name: 'Erika Leitung',
    art: 'druck',
    zugriff_at: '2026-05-27 10:05:00',
  },
  {
    id: 3,
    person_id: null,
    benutzer_id: 3,
    benutzer_name: 'Max Funk',
    art: 'export',
    zugriff_at: '2026-05-27 10:00:00',
  },
];

/** LFH-916 (Spec `personen-zugriffsprotokoll`): Schnellansicht der Listenzugriffe. */
describe('ListenzugriffeDrawer', () => {
  it('lädt nichts, solange die Ansicht zu ist', async () => {
    let abrufe = 0;
    server.use(
      http.get(URL, () => {
        abrufe += 1;
        return HttpResponse.json(eintraege);
      }),
    );
    renderMitProviders(<ListenzugriffeDrawer einsatzId={1} offen={false} onClose={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(abrufe).toBe(0);
    expect(screen.queryByText('Erika Leitung')).toBeNull();
  });

  it('zeigt die Einträge offen in Serverfolge mit Klartext der Art', async () => {
    server.use(http.get(URL, () => HttpResponse.json(eintraege)));
    renderMitProviders(<ListenzugriffeDrawer einsatzId={1} offen onClose={() => {}} />);
    const erste = await screen.findByText('Erika Leitung');
    const zeilen = within(erste.closest('tbody')!).getAllByRole('row');
    expect(zeilen).toHaveLength(2);
    expect(within(zeilen[0]).getByText('Liste gedruckt')).toBeInTheDocument();
    expect(within(zeilen[1]).getByText('Max Funk')).toBeInTheDocument();
    expect(within(zeilen[1]).getByText('Liste exportiert')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Listenzugriffe' })).toBeInTheDocument();
  });

  it('lädt bei jedem Öffnen frisch, damit ein eben gemachter Export erscheint', async () => {
    let abrufe = 0;
    server.use(
      http.get(URL, () => {
        abrufe += 1;
        return HttpResponse.json(abrufe === 1 ? eintraege.slice(1) : eintraege);
      }),
    );
    // Mit den Produktionsvorgaben (10 s frisch), sonst prüfte der Test nichts.
    const { rerender } = renderMitProviders(
      <ListenzugriffeDrawer einsatzId={1} offen onClose={() => {}} />,
      { client: erzeugeQueryClient() },
    );
    expect(await screen.findByText('Max Funk')).toBeInTheDocument();
    rerender(<ListenzugriffeDrawer einsatzId={1} offen={false} onClose={() => {}} />);
    rerender(<ListenzugriffeDrawer einsatzId={1} offen onClose={() => {}} />);
    expect(await screen.findByText('Erika Leitung')).toBeInTheDocument();
    expect(abrufe).toBe(2);
  });

  it('nennt den leeren Zustand', async () => {
    server.use(http.get(URL, () => HttpResponse.json([])));
    renderMitProviders(<ListenzugriffeDrawer einsatzId={1} offen onClose={() => {}} />);
    expect(
      await screen.findByText('Die Personenliste wurde noch nicht exportiert oder gedruckt'),
    ).toBeInTheDocument();
  });

  it('nennt einen Ladefehler, statt leer zu bleiben', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })));
    renderMitProviders(<ListenzugriffeDrawer einsatzId={1} offen onClose={() => {}} />);
    expect(
      await screen.findByText('Listenzugriffe konnten nicht geladen werden'),
    ).toBeInTheDocument();
  });
});
