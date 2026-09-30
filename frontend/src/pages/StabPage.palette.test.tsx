import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import StabPage from './StabPage';
import { benutzerFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

/**
 * „Neue Zeile" der Stab-Seite mit demselben Rechte-Riegel wie die Kopfaktion. Eigene Datei aus
 * denselben Gründen wie `SchaedenPage.palette.test.tsx`: `vi.mock` hoistet dateiweit, und das echte
 * `useBefehle` fordert `/api/einsaetze` an.
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
  meine_sachgebiete: [],
  org_id: 5,
  begonnen_at: '2026-06-11 05:00:00',
  abgeschlossen_at: null,
  lagekennzahlen: [],
};

function render(
  einsatzObj: object,
  stab: () => Response | Promise<Response> = () =>
    HttpResponse.json({ anzahl_lagebesprechungen: 0, besetzung: [] }),
) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', stab),
    http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
    // Quellen der Vorbereitung (LFH-550) — leer; diese Tests prüfen die Palette.
    ...[
      'personen',
      'personal',
      'uhs',
      'schaeden',
      'gefahrengebiete',
      'lageberichte',
      'einheiten',
      'fahrzeuge',
      'material',
      'abschnitte',
    ].map((l) => http.get(`/api/einsaetze/1/${l}`, () => HttpResponse.json([]))),
    http.get('/api/einsaetze/1/modul-zaehler', () => HttpResponse.json({})),
  );
  return renderMitProviders(
    <CommandPaletteProvider>
      <Routes>
        <Route path="/einsaetze/:id/stab" element={<StabPage />} />
      </Routes>
    </CommandPaletteProvider>,
    { route: '/einsaetze/1/stab' },
  );
}

/** Der Stand muss da sein — ohne ihn ist `neueZeile` absichtlich nicht registriert. */
async function standGeladen() {
  const sektion = await screen.findByRole('region', { name: 'Lagebesprechung' });
  await waitFor(() => expect(sektion).toHaveTextContent('kein Termin'));
}

describe('StabPage · „Neue Zeile" in der Kommandopalette', () => {
  it('bietet „Neue Zeile" mit Schreibrecht an und öffnet damit den Abschluss', async () => {
    const u = userEvent.setup();
    render(einsatzAktiv);
    await standGeladen();
    await u.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(document.getElementById('cmd-tastatur:neue-zeile')).not.toBeNull());

    await u.click(document.getElementById('cmd-tastatur:neue-zeile')!);
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
  });

  it('bietet sie dem Beobachter NICHT an', async () => {
    const u = userEvent.setup();
    render({ ...einsatzAktiv, meine_rolle: 'beobachter' });
    await standGeladen();
    await u.keyboard('{Control>}k{/Control}');
    // Positivhälfte: die Palette ist offen (ihr Eingabefeld trägt `role="combobox"`) — sonst
    // belegte das `null` unten nur eine geschlossene Palette.
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(document.getElementById('cmd-tastatur:neue-zeile')).toBeNull();
  });

  /** Ohne Stand fehlte der Termin zur Vorbelegung. */
  it('bietet sie NICHT an, solange der Stand lädt', async () => {
    const u = userEvent.setup();
    render(einsatzAktiv, () => new Promise<never>(() => {}));
    const sektion = await screen.findByRole('region', { name: 'Lagebesprechung' });
    // Schreibrecht besteht (kein Rechte-Hinweis) und der Stand lädt — sonst fehlte der Eintrag aus
    // dem falschen Grund.
    await waitFor(() => expect(screen.queryByText(/Nur Einsatzleitung/)).toBeNull());
    expect(within(sektion).queryByText('kein Termin')).toBeNull();
    await u.keyboard('{Control>}k{/Control}');
    // Positivhälfte: die Palette ist offen.
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(document.getElementById('cmd-tastatur:neue-zeile')).toBeNull();
  });
});
