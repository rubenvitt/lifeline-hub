import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { modulRegistry } from '../einsatz/modulRegistry';
import StabPage from './StabPage';

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const nutzer = {
  id: 1,
  anzeigename: 'Nutzer',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
};
const einsatz = (over: object = {}) => ({
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  meine_sachgebiete: [],
  org_id: 5,
  ...over,
});
const leererStab = { anzahl_lagebesprechungen: 0, besetzung: [] };
const label = (key: string) => modulRegistry.find((m) => m.key === key)!.label;

function rendere({
  einsatzObj = einsatz(),
  stab = leererStab as object,
  stabStatus = 200,
  overrides = {} as object,
} = {}) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', () =>
      stabStatus === 200
        ? HttpResponse.json(stab)
        : HttpResponse.json({ error: 'kaputt' }, { status: stabStatus }),
    ),
    http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json(overrides)),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab" element={<StabPage />} />
    </Routes>,
    { route: '/einsaetze/1/stab' },
  );
}

async function besetzungsSektion() {
  return screen.findByRole('region', { name: 'Besetzung S1–S6' });
}

describe('StabPage', () => {
  it('zeigt sechs feste Zeilen auch ohne jede Besetzung', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    await waitFor(() =>
      expect(
        within(sektion)
          .getAllByRole('heading', { level: 4 })
          .map((h) => h.textContent),
      ).toEqual([
        expect.stringContaining('S1 · Personal'),
        expect.stringContaining('S2 · Lage'),
        expect.stringContaining('S3 · Einsatz'),
        expect.stringContaining('S4 · Versorgung'),
        expect.stringContaining('S5 · Presse- und Medienarbeit'),
        expect.stringContaining('S6 · Information und Kommunikation'),
      ]),
    );
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(6);
  });

  it('nennt die Besetzung beim Wort', async () => {
    rendere({
      stab: {
        anzahl_lagebesprechungen: 0,
        besetzung: [
          {
            sachgebiet: 's2',
            besetzung_art: 'personal',
            personal_id: 99,
            name: 'Müller',
            personal_noch_disponiert: true,
            gesetzt_at: '2026-09-13 10:00:00',
            gesetzt_von_id: 1,
          },
        ],
      },
    });
    const sektion = await besetzungsSektion();
    expect(await within(sektion).findByText('Müller')).toBeInTheDocument();
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(5);
  });

  describe('Rechte-Paar', () => {
    it('mit Schreibrecht: je Zeile „Besetzung ändern", kein Rechte-Hinweis', async () => {
      rendere();
      const sektion = await besetzungsSektion();
      await waitFor(() =>
        expect(
          within(sektion).getAllByRole('button', { name: /^Besetzung ändern – S\d/ }),
        ).toHaveLength(6),
      );
      expect(screen.queryByText(/können die Besetzung ändern/)).toBeNull();
    });

    it('als Beobachter: keine Zeilenaktion, der Grund steht auf der Seite', async () => {
      rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
      const sektion = await besetzungsSektion();
      expect(
        await screen.findByText(/Nur Einsatzleitung und Führungspersonal/),
      ).toBeInTheDocument();
      expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(
        0,
      );
    });

    it('im abgeschlossenen Einsatz: keine Zeilenaktion, Hinweis nennt den Abschluss', async () => {
      rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
      await besetzungsSektion();
      expect(await screen.findByText(/Der Einsatz ist abgeschlossen/)).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });
  });

  it('behauptet während des Ladens keine Besetzung', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      // Antwort bleibt aus: der Abruf steht dauerhaft auf „lädt".
      http.get('/api/einsaetze/1/stab', () => new Promise<never>(() => {})),
      http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/stab" element={<StabPage />} />
      </Routes>,
      { route: '/einsaetze/1/stab' },
    );
    const sektion = await besetzungsSektion();
    expect(within(sektion).getAllByRole('heading', { level: 4 })).toHaveLength(6);
    expect(within(sektion).queryByText('nicht vergeben')).toBeNull();
    expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
  });

  it('Fehler ist nicht leer: ein gescheiterter Abruf behauptet keine sechs leeren Zeilen', async () => {
    rendere({ stabStatus: 500 });
    expect(
      await screen.findByText('Führungsorganisation konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('nicht vergeben')).toBeNull();
  });

  it('Werkzeug-Links zeigen nur freigegebene Module', async () => {
    rendere({ overrides: { chat: { sichtbar: false } } });
    await besetzungsSektion();
    const s4 = await screen.findByRole('group', { name: 'Werkzeuge S4' });
    expect(within(s4).getByRole('link', { name: label('nachforderungen') })).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen',
    );
    const s6 = screen.getByRole('group', { name: 'Werkzeuge S6' });
    expect(within(s6).queryByRole('link', { name: label('chat') })).toBeNull();
    expect(within(s6).getByRole('link', { name: label('einsatzabschnitte') })).toBeInTheDocument();
  });

  it('„Besetzung ändern" öffnet die Maske der Zeile', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    const knopf = await within(sektion).findByRole('button', {
      name: 'Besetzung ändern – S4 Versorgung',
    });
    await userEvent.click(knopf);
    expect(await screen.findByText('Besetzung S4 · Versorgung')).toBeInTheDocument();
  });
});
