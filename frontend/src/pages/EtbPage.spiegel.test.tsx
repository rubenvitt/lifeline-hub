import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { einsatzKeys } from '../api/queryKeys';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { entwuerfeLeerenFuerTests } from '../etb/entwuerfe/entwurfStore';
import { SCHLUESSEL_ETB_STANDARD_RUFNAME } from '../etb/standardRufname';
import { queueLeerenFuerTests } from '../offline/queue';
import { adminFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EtbPage from './EtbPage';

/**
 * ETB am Spiegel (LLH-1492, Spec `spiegel-antraege`, „ETB-Eintrag am Hub“): erfassen geht (als
 * Antrag), ohne Anhang; ein beantragter Eintrag steht wie ein ausstehender, ohne laufende Nummer,
 * und der Zähler bleibt der des Servers.
 */
const spiegel = {
  gegenstelle: 'ELW 1',
  letzter_abgleich_at: '2026-11-10 08:00:00',
  beendet: false,
  antraege_ausstehend: 1,
  antraege_abgelehnt: 0,
};
const einsatz = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00',
  meine_rolle: 'fuehrungspersonal',
  spiegel,
};
const eintrag = {
  id: 1,
  lfd_nr: 1,
  typ: 'meldung',
  inhalt: 'Erste Meldung',
  erfasser_id: 1,
  erfasser_name: 'Admin',
  ereigniszeit: '2026-05-23 10:00:00',
  received_at: '2026-05-23 10:00:01',
  folgeauftraege: [],
  anhaenge: [],
};

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  await queueLeerenFuerTests();
  localStorage.clear();
});

function setup(antraege: unknown[]) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/etb', () => HttpResponse.json([eintrag])),
    http.get('/api/einsaetze/7/etb/zaehler', () =>
      HttpResponse.json({
        gesamt: 1,
        je_typ: { meldung: 1, anordnung: 0, lage: 0, entscheidung: 0, system: 0, berichtigung: 0 },
      }),
    ),
    http.get('/api/etb-bausteine', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
    http.get('/api/benutzer-einstellungen', () =>
      HttpResponse.json({
        eintraege: { [SCHLUESSEL_ETB_STANDARD_RUFNAME]: '{"von":"ELW 1","an":"ELW 1"}' },
      }),
    ),
  );
  // Die Anträge lädt im Rahmen das Hinweisband; die Seite liest sie aus dem Cache.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(einsatzKeys.antraege(7), antraege);
  return renderMitProviders(
    <CommandPaletteProvider>
      <Routes>
        <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
      </Routes>
    </CommandPaletteProvider>,
    { route: '/einsaetze/7/etb', client },
  );
}

describe('EtbPage am Spiegel (LLH-1492)', () => {
  it('erfassen geht, ohne Anhang und ohne „Nur Ansicht“', async () => {
    setup([]);
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();
    expect(document.querySelector('.etb-erfassung-sticky')).not.toBeNull();
    expect(document.querySelector('[data-lfh="rechte-hinweis"]')).toBeNull();
    // Die Erfassung steht (eingeklappt oder offen); den fehlenden Anhang belegt
    // `Schnellerfassung.anhaenge.test.tsx`.
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="etb-erfassung"]')).not.toBeNull(),
    );
  });

  it('zeigt einen beantragten Eintrag wie einen ausstehenden, ohne Nummer', async () => {
    setup([
      {
        id: 5,
        art: 'etb',
        zustand: 'ausstehend',
        erfasst_at: '2026-11-10 08:00:00',
        ziel: {},
        daten: { typ: 'meldung', inhalt: 'Beantragter Eintrag', client_id: 'c-1' },
      },
      {
        id: 6,
        art: 'etb',
        zustand: 'abgelehnt',
        grund: 'Einsatz ist abgeschlossen',
        erfasst_at: '2026-11-10 08:01:00',
        ziel: {},
        daten: { typ: 'meldung', inhalt: 'Abgelehnter Eintrag' },
      },
    ]);
    const text = await screen.findByText('Beantragter Eintrag');
    const zeile = text.closest('[data-testid="etb-ereigniszeile"]') as HTMLElement;
    expect(zeile).toHaveAttribute('data-zeile', 'beantragt-5');
    expect(within(zeile).getByText('beantragt')).toBeInTheDocument();
    expect(within(zeile).queryByText(/^Nr\./)).toBeNull();
    // Abgelehnte stehen im Hinweisband, nicht in der Zeitachse.
    expect(screen.queryByText('Abgelehnter Eintrag')).toBeNull();
  });
});
