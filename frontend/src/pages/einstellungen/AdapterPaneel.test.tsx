import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { adapterFixture, adapterListeFixture } from '../../test/adapterDaten';
import type { AdapterListe } from '../../api/types';
import AdapterPaneel from './AdapterPaneel';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

/** Paneel „Adapter“ auf der Seite Anbindungen (LLH-2018). */

function stelleBereit(liste: AdapterListe) {
  const aufrufe: unknown[] = [];
  server.use(
    http.get('/api/admin/adapter', () => HttpResponse.json(liste)),
    http.post('/api/admin/adapter', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push(body);
      return HttpResponse.json(adapterFixture('neu', { name: String(body.name), zustand: 'wartet' }), {
        status: 201,
      });
    }),
  );
  return aufrufe;
}

function rendere() {
  return renderMitProviders(
    <Routes>
      <Route path="/admin/einstellungen/anbindungen" element={<AdapterPaneel />} />
      <Route
        path="/admin/einstellungen/anbindungen/adapter/:adapterId"
        element={<p>Ansicht des Adapters</p>}
      />
    </Routes>,
    { route: '/admin/einstellungen/anbindungen', datenRouter: true },
  );
}

describe('AdapterPaneel', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('bleibt weg, solange der Server keine Art kennt und kein Adapter besteht', async () => {
    let geladen = false;
    server.use(
      http.get('/api/admin/adapter', () => {
        geladen = true;
        return HttpResponse.json({ adapter: [], arten: [], speicher: 'bereit' });
      }),
    );
    rendere();
    await waitFor(() => expect(geladen).toBe(true));
    expect(screen.queryByRole('heading', { name: /Adapter/ })).not.toBeInTheDocument();
  });

  it('zeigt einen Adapter unbekannter Art auch ohne Arten', async () => {
    stelleBereit(
      adapterListeFixture({
        arten: [],
        adapter: [adapterFixture('alt', { zustand: 'art_unbekannt', art_bezeichnung: undefined })],
      }),
    );
    rendere();
    expect(await screen.findByRole('link', { name: 'Adapter alt' })).toBeInTheDocument();
    expect(screen.getByText('Art unbekannt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adapter anlegen' })).not.toBeInTheDocument();
  });

  it('zeigt den Status nur, wenn er etwas verlangt, und die Nebenangaben', async () => {
    stelleBereit(
      adapterListeFixture({
        adapter: [
          adapterFixture('ok'),
          adapterFixture('st', {
            zustand: 'gestoert',
            fehler_seit: '2026-11-22 08:42:00',
            letzter_fehler: { at: '2026-11-22 08:51:00', art: 'zeitueberschreitung' },
          }),
          adapterFixture('ein', {
            zustand: 'braucht_eingriff',
            angehalten_grund: 'abgelehnt',
            letzter_fehler: { at: '2026-11-22 08:51:00', art: 'abgelehnt', status: 401 },
          }),
        ],
      }),
    );
    rendere();
    const ok = (await screen.findByRole('link', { name: 'Adapter ok' })).closest<HTMLElement>(
      '[data-lfh="adapter-eintrag"]',
    )!;
    expect(within(ok).queryByText('ok')).not.toBeInTheDocument();
    expect(ok).toHaveTextContent(/Beispiel-Alarmquelle · zuletzt erfolgreich/);
    const st = screen.getByRole('link', { name: 'Adapter st' }).closest<HTMLElement>(
      '[data-lfh="adapter-eintrag"]',
    )!;
    expect(within(st).getByText('gestört')).toBeInTheDocument();
    expect(st).toHaveTextContent(/letzter Fehler Keine Antwort in 20 s/);
    const ein = screen.getByRole('link', { name: 'Adapter ein' }).closest<HTMLElement>(
      '[data-lfh="adapter-eintrag"]',
    )!;
    expect(within(ein).getByText('braucht Eingriff')).toBeInTheDocument();
    expect(ein).toHaveTextContent(/angehalten: Zugang abgelehnt/);
  });

  it('nennt einen fehlenden Schlüssel des Geheimnisspeichers', async () => {
    stelleBereit(adapterListeFixture({ speicher: 'fehlt', speicher_fingerabdruck: undefined }));
    rendere();
    expect(await screen.findByText(/Schlüssel fehlt: Geheimnisse lassen sich nicht setzen/)).toBeInTheDocument();
  });

  it('legt einen Adapter mit den Feldern der Art an und springt in die Ansicht', async () => {
    const aufrufe = stelleBereit(adapterListeFixture({ adapter: [] }));
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Adapter anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adapter anlegen' });
    expect(within(dialog).getByRole('spinbutton', { name: 'Intervall' })).toHaveValue('60');
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Alarmquelle Leitstelle');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Adresse' }),
      'https://alarm.example/api',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        {
          art: 'beispiel',
          name: 'Alarmquelle Leitstelle',
          einstellungen: { url: 'https://alarm.example/api' },
          intervall_s: 60,
        },
      ]),
    );
    expect(await screen.findByText('Ansicht des Adapters')).toBeInTheDocument();
  });

  it('verlangt die Pflichtfelder der Art', async () => {
    const aufrufe = stelleBereit(adapterListeFixture({ adapter: [] }));
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Adapter anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adapter anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'X');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText('Adresse fehlt')).toBeInTheDocument();
    expect(aufrufe).toEqual([]);
  });

  it('lässt die Führungskraft nur lesen', async () => {
    vi.mocked(useAuth).mockReturnValue(
      authWertFixture(benutzerFixture({ org_rolle: 'fuehrungskraft' })),
    );
    stelleBereit(adapterListeFixture());
    rendere();
    expect(await screen.findByRole('link', { name: 'Adapter a1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adapter anlegen' })).not.toBeInTheDocument();
  });

  it('sperrt das Anlegen am gekoppelten ELW', async () => {
    stelleBereit(adapterListeFixture({ gesperrt_grund: 'Diese Instanz meldet sich beim Hub.' }));
    rendere();
    expect(await screen.findByRole('button', { name: 'Adapter anlegen' })).toBeDisabled();
  });
});
