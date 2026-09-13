import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import StabPage from './StabPage';

/**
 * „Neue Zeile" der Stab-Seite (LFH-543) mit DEMSELBEN Rechte-Riegel wie die Kopfaktion.
 * Eigene Datei aus denselben Gründen wie `SchaedenPage.palette.test.tsx`: `vi.mock` hoistet
 * dateiweit, und das echte `useBefehle` fordert `/api/einsaetze` an.
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

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const nutzer = {
  id: 1,
  anzeigename: 'Nutzer',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
};
const einsatzAktiv = {
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  meine_sachgebiete: [],
  org_id: 5,
};

function render(
  einsatzObj: object,
  stab: () => Response | Promise<Response> = () =>
    HttpResponse.json({ anzahl_lagebesprechungen: 0, besetzung: [] }),
) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', stab),
    http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
  );
  return renderMitProviders(
    <AuthProvider>
      <CommandPaletteProvider>
        <Routes>
          <Route path="/einsaetze/:id/stab" element={<StabPage />} />
        </Routes>
      </CommandPaletteProvider>
    </AuthProvider>,
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
    // Positivhälfte: die Palette IST offen (ihr Eingabefeld trägt `role="combobox"`,
    // `CommandPalette.tsx:299`) — sonst belegte das `null` unten nur eine geschlossene Palette.
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(document.getElementById('cmd-tastatur:neue-zeile')).toBeNull();
  });

  /** Ruling 4 / Plan-Abweichung 7: ohne Stand fehlte der Termin zur Vorbelegung. */
  it('bietet sie NICHT an, solange der Stand lädt', async () => {
    const u = userEvent.setup();
    render(einsatzAktiv, () => new Promise<never>(() => {}));
    const sektion = await screen.findByRole('region', { name: 'Lagebesprechung' });
    // Schreibrecht besteht (kein Rechte-Hinweis) und der Stand lädt (kein Termin behauptet) —
    // sonst fehlte der Eintrag aus dem falschen Grund.
    await waitFor(() => expect(screen.queryByText(/Nur Einsatzleitung/)).toBeNull());
    expect(within(sektion).queryByText('kein Termin')).toBeNull();
    await u.keyboard('{Control>}k{/Control}');
    // Positivhälfte: die Palette IST offen.
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(document.getElementById('cmd-tastatur:neue-zeile')).toBeNull();
  });
});
