import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import SchaedenPage from './SchaedenPage';
import { benutzerFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

/**
 * „Neue Zeile" an einer echten Modulseite — mit demselben Rechte-Riegel wie der Knopf daneben.
 *
 * Das ist die tragende Aussage der Datei: die Palette ist ein zweiter Bedienweg auf dieselbe
 * Aktion, und das Vorhandensein des Callbacks ist kein Rechtebeleg. Der Test „versteckt
 * Schreib-Buttons für Beobachter" (`SchaedenPage.test.tsx`) deckt nur den Knopf ab.
 *
 * Eigene Datei: `vi.mock` hoistet dateiweit, und `src/test/setup.ts` fährt MSW mit
 * `onUnhandledRequest: 'error'` — das echte `useBefehle` fordert beim Öffnen `/api/einsaetze` an.
 *
 * Gegriffen wird auf `#cmd-tastatur:<id>`, nicht auf den Wortlaut: der kommt aus
 * `TASTATUR_AKTIONEN` und ist dort gepinnt (`befehle.test.ts`).
 */
vi.mock('../command-palette/useBefehle', () => ({
  useBefehle: (aktionen: TastaturAktionen = {}) =>
    Object.entries(aktionen).map(([id, ausfuehren]) => ({
      id: `tastatur:${id}`,
      gruppe: 'aktionen',
      label: id,
      ausfuehren,
    })),
}));

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const nutzer = benutzerFixture({ org_rolle: 'fuehrungskraft' });
const einsatzAktiv = {
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  org_id: 5,
  org_name: 'DRK Musterstadt',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const einSchaden = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'offen',
  typ: 'sachschaden',
  ausmass: 'gering',
  ort: 'Hauptstr. 17',
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
  erfasst_at: '2026-05-29 10:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-29 10:00:00',
  geaendert_von: 1,
  storniert_at: null,
  storniert_von: null,
  geschaedigt_registrier_nr: null,
  geschaedigt_storniert_at: null,
  geschaedigt_personal_name: null,
  geschaedigt_organisation_name: null,
};

function render(einsatzObj: object) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([einSchaden])),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <CommandPaletteProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
      </Routes>
    </CommandPaletteProvider>,
    { route: '/einsaetze/1/schaeden' },
  );
}

/**
 * Öffnet die Palette mit dem Fokus im Suchfeld der `Datensicht`, damit die Kette aus Werkzeugzeile
 * („Filter zurücksetzen") und Seite („Neue Zeile") im Spiel ist. `filter-zuruecksetzen` ist die
 * Positivhälfte jeder „… ist nicht gemeldet"-Aussage — ohne sie belegte ein `null` nur eine
 * geschlossene Palette.
 */
async function oeffnePalette(u: ReturnType<typeof userEvent.setup>) {
  await u.click(await screen.findByRole('searchbox', { name: 'Suche in Schäden im Einsatz' }));
  await u.keyboard('{Control>}k{/Control}');
  await waitFor(() =>
    expect(document.getElementById('cmd-tastatur:filter-zuruecksetzen')).not.toBeNull(),
  );
}

describe('SchaedenPage · „Neue Zeile" in der Kommandopalette', () => {
  it('bietet „Neue Zeile" mit Schreibrecht an und öffnet damit die Schnellerfassung', async () => {
    const u = userEvent.setup();
    render(einsatzAktiv);
    await screen.findByText('S-001');
    await oeffnePalette(u);

    const option = document.getElementById('cmd-tastatur:neue-zeile');
    expect(option).not.toBeNull();

    await u.click(option!);
    // Dieselbe Wirkung wie der Knopf daneben — die Palette ruft den echten Callback der Seite.
    expect(await screen.findByText('Schaden erfassen')).toBeInTheDocument();
  });

  it('bietet sie dem Beobachter NICHT an', async () => {
    const u = userEvent.setup();
    render(einsatzBeobachter);
    await screen.findByText('S-001');
    await oeffnePalette(u);

    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
    expect(document.getElementById('cmd-tastatur:neue-zeile')).toBeNull();
  });
});
